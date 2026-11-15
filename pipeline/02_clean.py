"""Step 2 (S11): clean the raw FIRMS chunk files into one uniform schema, one file per region, source and year.

Input:  data/raw/<SOURCE>/<REGION>/<YYYY-MM-DD>_<n>d.csv  (from 01_download.py)
Output: data/interim/clean/<REGION>/<SOURCE>/<YEAR>.parquet  (columns: common.CLEAN_COLUMNS)
        data/interim/clean/<REGION>/<SOURCE>/<YEAR>.json     (counts for that file)
        data/interim/reports/clean_summary.csv, clean_versions.csv

No double counting:
- Each row is put in the year of its own acq_date, so a chunk that spans New Year is read for both
  years but each row lands in exactly one year file.
- Exact duplicate rows are dropped (the S09 2023 test chunks overlap the full-range chunks for US-CA).
- Outputs are overwritten, never appended, so re-running cannot add rows twice.
- Check printed per region and source: rows read = rows written + duplicates dropped.
Nothing is filtered here (all confidence classes and types are kept); filtering is step 03.

Examples:
  python3 pipeline/02_clean.py                      # every region found in data/raw
  python3 pipeline/02_clean.py --region PT
  python3 pipeline/02_clean.py --region US-CA --sources MODIS_SP --force
"""
import argparse
import csv
import json
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402
from common import CLEAN_COLUMNS  # noqa: E402

SORT_KEYS = ["date", "time_utc", "satellite", "latitude", "longitude", "frp", "brightness"]


class CleanError(Exception):
    pass


def read_chunk(path):
    """Read one raw chunk file as text columns. Returns an empty frame for a header-only or empty file."""
    if path.stat().st_size == 0:
        return pd.DataFrame()
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def modis_class(values):
    conf = pd.to_numeric(values, errors="coerce")
    if conf.isna().any() or ((conf < 0) | (conf > 100)).any():
        raise CleanError(f"MODIS confidence outside 0-100: {sorted(set(values[conf.isna() | (conf < 0) | (conf > 100)]))[:5]}")
    out = pd.Series("nominal", index=values.index, dtype="string")
    out[conf < config.MODIS_CONFIDENCE_LOW_BELOW] = "low"
    out[conf >= config.MODIS_CONFIDENCE_HIGH_FROM] = "high"
    return out


def normalize(raw, region, source, where=""):
    """Turn raw FIRMS text columns into the cleaned schema. Raises CleanError on any unexpected value."""
    sensor = config.SENSOR_OF_SOURCE[source]
    expected = common.MODIS_HEADER if sensor == "MODIS" else common.VIIRS_HEADER
    if raw.empty and len(raw.columns) == 0:
        return empty_frame()
    if list(raw.columns) != expected:
        raise CleanError(f"{where}: unexpected header {list(raw.columns)}")
    if raw.empty:
        return empty_frame()

    sat = raw["satellite"].map(config.SATELLITE_CODES)
    if sat.isna().any():
        raise CleanError(f"{where}: unknown satellite values {sorted(set(raw['satellite'][sat.isna()]))}")
    if sensor == "MODIS":
        conf = modis_class(raw["confidence"])
    else:
        conf = raw["confidence"].map(config.VIIRS_CONFIDENCE)
        if conf.isna().any():
            raise CleanError(f"{where}: unknown VIIRS confidence {sorted(set(raw['confidence'][conf.isna()]))}")
    t = raw["acq_time"].str.strip().str.zfill(4)
    if not t.str.fullmatch(r"([01]\d|2[0-3])[0-5]\d").all():
        raise CleanError(f"{where}: bad acq_time values {sorted(set(raw['acq_time'][~t.str.fullmatch(r'([01]\d|2[0-3])[0-5]\d')]))[:5]}")
    d = pd.to_datetime(raw["acq_date"], format="%Y-%m-%d", errors="coerce")
    if d.isna().any():
        raise CleanError(f"{where}: bad acq_date values {sorted(set(raw['acq_date'][d.isna()]))[:5]}")
    typ = pd.to_numeric(raw["type"], errors="coerce")
    if typ.isna().any() or not typ.isin([0, 1, 2, 3]).all():
        raise CleanError(f"{where}: unexpected type values {sorted(set(raw['type'][~typ.isin([0, 1, 2, 3])]))}")
    dn = raw["daynight"].str.strip()
    if not dn.isin(["D", "N"]).all():
        raise CleanError(f"{where}: unexpected daynight values {sorted(set(dn[~dn.isin(['D', 'N'])]))}")

    def num(col):
        v = pd.to_numeric(raw[col], errors="coerce")
        if v.isna().any():
            raise CleanError(f"{where}: non-numeric {col} values {sorted(set(raw[col][v.isna()]))[:5]}")
        return v.astype("float64")

    out = pd.DataFrame({
        "region_id": region,
        "source": source,
        "sensor": sensor,
        "satellite": sat,
        "date": d.dt.strftime("%Y-%m-%d"),
        "time_utc": t,
        "latitude": num("latitude"),
        "longitude": num("longitude"),
        "confidence": conf,
        "confidence_raw": raw["confidence"].str.strip(),
        "type": typ.astype("int8"),
        "frp": num("frp"),
        "daynight": dn,
        "brightness": num("brightness" if sensor == "MODIS" else "bright_ti4"),
        "bright_bg": num("bright_t31" if sensor == "MODIS" else "bright_ti5"),
        "scan": num("scan"),
        "track": num("track"),
        "version": raw["version"].str.strip(),
    })
    if not out["latitude"].between(-90, 90).all() or not out["longitude"].between(-180, 180).all():
        raise CleanError(f"{where}: latitude/longitude out of range")
    return enforce_schema(out)


def empty_frame():
    return enforce_schema(pd.DataFrame({c: pd.Series(dtype=t) for c, t in CLEAN_COLUMNS.items()}))


def enforce_schema(df):
    """Same columns, order and dtypes everywhere."""
    return df[list(CLEAN_COLUMNS)].astype(CLEAN_COLUMNS)


def outside_box(df, region):
    w, s, e, n = config.REGIONS[region]["bbox"]
    return int((~(df["longitude"].between(w, e) & df["latitude"].between(s, n))).sum())


def clean_year(region, source, year, files):
    """Clean all rows dated in `year` from the given chunk files. Returns (frame, report dict)."""
    parts, outside_window, files_used = [], 0, 0
    for path, first, last in files:
        raw = read_chunk(path)
        files_used += 1
        if raw.empty:
            continue
        df = normalize(raw, region, source, where=str(path))
        in_window = (df["date"] >= first.isoformat()) & (df["date"] <= last.isoformat())
        outside_window += int((~in_window).sum())
        parts.append(df[df["date"].str.startswith(f"{year}-")])
    df = pd.concat(parts, ignore_index=True) if parts else empty_frame()
    rows_read = len(df)
    df = df.drop_duplicates(ignore_index=True)
    df = enforce_schema(df.sort_values(SORT_KEYS, kind="mergesort", ignore_index=True))
    versions = {}
    for v, g in df.groupby("version"):
        versions[str(v)] = {"rows": int(len(g)), "first_date": g["date"].min(), "last_date": g["date"].max()}
    report = {
        "region_id": region, "source": source, "year": year, "files": files_used,
        "rows_read": rows_read, "duplicates_dropped": rows_read - len(df), "rows_out": len(df),
        "rows_outside_file_window": outside_window, "rows_outside_download_box": outside_box(df, region),
        "first_date": df["date"].min() if len(df) else None, "last_date": df["date"].max() if len(df) else None,
        "by_satellite": {k: int(v) for k, v in df["satellite"].value_counts().sort_index().items()},
        "by_confidence": {k: int(v) for k, v in df["confidence"].value_counts().sort_index().items()},
        "by_type": {str(k): int(v) for k, v in df["type"].value_counts().sort_index().items()},
        "versions": versions,
    }
    return df, report


def raw_row_count(files):
    n = 0
    for path, _, _ in files:
        if path.stat().st_size:
            with path.open() as f:
                n += max(sum(1 for line in f if line.strip()) - 1, 0)
    return n


def clean_region_source(region, source, raw=common.RAW, out=common.CLEAN, force=False, log=print):
    files = common.chunk_files(Path(raw) / source / region)
    if not files:
        log(f"{region} {source}: no raw files, skipped")
        return []
    reports = []
    for year in common.years_of(files):
        target = common.year_path(out, region, source, year)
        side = target.with_suffix(".json")
        if target.exists() and side.exists() and not force:
            reports.append(json.loads(side.read_text()))
            continue
        df, rep = clean_year(region, source, year, common.files_for_year(files, year))
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".parquet.part")
        df.to_parquet(tmp, index=False)
        tmp.replace(target)
        side.write_text(json.dumps(rep, indent=1))
        reports.append(rep)
    total_raw = raw_row_count(files)
    read = sum(r["rows_read"] for r in reports)
    dup = sum(r["duplicates_dropped"] for r in reports)
    kept = sum(r["rows_out"] for r in reports)
    outside_w = sum(r["rows_outside_file_window"] for r in reports)
    status = "OK" if read == total_raw and read == kept + dup else "CHECK"
    log(f"{region} {source}: {len(files)} files, raw rows {total_raw:,}, rows read {read:,}, "
        f"duplicates dropped {dup:,}, kept {kept:,}, outside file window {outside_w:,} [{status}]")
    if status != "OK":
        log("  CHECK: raw rows and rows read differ. A row dated outside its chunk's dates was counted "
            "in another year or not at all; look at rows_outside_file_window in the .json files.")
    return reports


SUMMARY_FIELDS = ["region_id", "source", "year", "files", "rows_read", "duplicates_dropped", "rows_out",
                  "rows_outside_file_window", "rows_outside_download_box", "first_date", "last_date",
                  "sat_T", "sat_A", "sat_N", "sat_N20", "sat_N21", "conf_low", "conf_nominal", "conf_high",
                  "type_0", "type_1", "type_2", "type_3"]


def write_reports(reports, folder=common.REPORTS):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "clean_summary.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=SUMMARY_FIELDS)
        w.writeheader()
        for r in reports:
            row = {k: r.get(k) for k in SUMMARY_FIELDS[:11]}
            row.update({f"sat_{s}": r["by_satellite"].get(s, 0) for s in ("T", "A", "N", "N20", "N21")})
            row.update({f"conf_{c}": r["by_confidence"].get(c, 0) for c in ("low", "nominal", "high")})
            row.update({f"type_{t}": r["by_type"].get(str(t), 0) for t in range(4)})
            w.writerow(row)
    # MODIS 6.03 -> 61.03 switch (and any other version change): first/last date per version.
    agg = {}
    for r in reports:
        for v, info in r["versions"].items():
            key = (r["region_id"], r["source"], v)
            a = agg.setdefault(key, {"rows": 0, "first_date": info["first_date"], "last_date": info["last_date"]})
            a["rows"] += info["rows"]
            a["first_date"] = min(a["first_date"], info["first_date"])
            a["last_date"] = max(a["last_date"], info["last_date"])
    with (folder / "clean_versions.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["region_id", "source", "version", "rows", "first_date", "last_date"])
        for (reg, src, v), a in sorted(agg.items()):
            w.writerow([reg, src, v, a["rows"], a["first_date"], a["last_date"]])
    return folder


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append", choices=list(config.REGIONS), help="repeat for several; default all found")
    p.add_argument("--sources", nargs="+", choices=common.SOURCES, default=list(common.SOURCES))
    p.add_argument("--force", action="store_true", help="redo years that are already cleaned")
    a = p.parse_args(argv)
    regions = a.region or [r for r in common.regions_present(common.RAW, a.sources) if r in config.ACTIVE_REGIONS]
    if not regions:
        raise SystemExit(f"No raw data found in {common.RAW}. Run step 01 first (and in Colab, check Drive is mounted).")
    t0 = time.time()
    reports = []
    for region in regions:
        for source in a.sources:
            reports += clean_region_source(region, source, force=a.force)
    # Re-read every year's .json so the summary covers all regions, not only this run's.
    all_reports = [json.loads(p.read_text()) for p in sorted(common.CLEAN.glob("*/*/*.json"))]
    folder = write_reports(all_reports)
    kept = sum(r["rows_out"] for r in all_reports)
    print(f"Cleaned rows (all regions and sources on disk): {kept:,}. Reports: {folder}/clean_summary.csv, "
          f"clean_versions.csv. Took {time.time() - t0:.0f} s.")
    print("Version ranges (first/last date per FIRMS collection version):")
    print((folder / "clean_versions.csv").read_text().strip())


if __name__ == "__main__":
    try:
        main()
    except CleanError as e:
        raise SystemExit(f"Cleaning stopped: {e}")
