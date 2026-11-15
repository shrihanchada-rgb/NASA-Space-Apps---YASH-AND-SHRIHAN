"""Small, shareable extract of the interim data (cleaned + filtered detections) for the repo.

The full interim files (data/interim/clean, data/interim/filtered: about 19 million rows) live on Google
Drive and are too big for git. This script writes a small summary that AIs and people can read
without Drive. It is copied into the repo folder `data/interim_extract/`.

Input:  data/interim/clean/, data/interim/filtered/ (from 02_clean.py, 03_filter.py), data/raw/ file names
Output: data/interim/extract/
  daily_counts.csv   one row per region, source, satellite and UTC day with at least one cleaned detection
  coverage.csv       per region and source: first/last day downloaded, days downloaded, missing days
  samples/<REGION>__<SOURCE>.csv  200 real filtered rows (fixed random sample, same columns as the parquet files)
  MANIFEST.json      what was built, when, row counts

A day that was downloaded but has no row in daily_counts.csv means "observed, 0 detections".
A day outside coverage.csv's downloaded days means "no data".

Example:  python3 pipeline/03c_interim_extract.py      (Colab: STEPS = ["03c"])
"""
import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402

EXTRACT = common.INTERIM / "extract"
SAMPLE_ROWS = 200
DAILY_COLUMNS = ["region_id", "date", "source", "sensor", "satellite", "n_clean", "n_kept", "n_kept_high",
                 "n_kept_night", "frp_sum_kept"]


def daily_counts(region, source, clean=common.CLEAN, filtered=common.FILTERED):
    parts = []
    for path in sorted((Path(clean) / region / source).glob("*.parquet")):
        c = pd.read_parquet(path, columns=["date", "satellite"])
        fpath = Path(filtered) / region / source / path.name
        f = pd.read_parquet(fpath, columns=["date", "satellite", "confidence", "daynight", "frp"]) if fpath.exists() else c.iloc[0:0]
        nc = c.groupby(["date", "satellite"]).size().rename("n_clean")
        if len(f):
            f = f.assign(n_kept=1, n_kept_high=(f["confidence"] == "high").astype(int),
                         n_kept_night=(f["daynight"] == "N").astype(int))
            kept = f.groupby(["date", "satellite"])[["n_kept", "n_kept_high", "n_kept_night", "frp"]].sum()
            kept = kept.rename(columns={"frp": "frp_sum_kept"})
            kept["frp_sum_kept"] = kept["frp_sum_kept"].round(1)
        else:
            kept = pd.DataFrame(columns=["n_kept", "n_kept_high", "n_kept_night", "frp_sum_kept"])
        d = pd.concat([nc, kept], axis=1).fillna(0).reset_index()
        if len(d):
            parts.append(d)
    if not parts:
        return pd.DataFrame(columns=DAILY_COLUMNS)
    d = pd.concat(parts, ignore_index=True)
    d.insert(0, "region_id", region)
    d.insert(2, "source", source)
    d.insert(3, "sensor", config.SENSOR_OF_SOURCE[source])
    for col in ("n_clean", "n_kept", "n_kept_high", "n_kept_night"):
        d[col] = d[col].astype(int)
    return d[DAILY_COLUMNS].sort_values(["date", "satellite"], ignore_index=True)


def coverage(region, source, raw=common.RAW, availability=None):
    files = common.chunk_files(Path(raw) / source / region)
    if not files:
        return None
    have = set()
    for _, first, last in files:
        d = first
        while d <= last:
            have.add(d)
            d += dt.timedelta(days=1)
    first, last = common.source_dates(source, availability)
    expected = {first + dt.timedelta(days=i) for i in range((last - first).days + 1)}
    missing = sorted(expected - have)
    return {"region_id": region, "source": source, "first_day": min(have).isoformat(), "last_day": max(have).isoformat(),
            "days_downloaded": len(have), "days_missing": len(missing),
            "missing_first": missing[0].isoformat() if missing else "", "missing_last": missing[-1].isoformat() if missing else ""}


def sample_rows(region, source, filtered=common.FILTERED, n=SAMPLE_ROWS):
    files = sorted((Path(filtered) / region / source).glob("*.parquet"))
    if not files:
        return None
    df = pd.concat([pd.read_parquet(p) for p in files], ignore_index=True)
    if len(df) > n:
        df = df.sample(n=n, random_state=0)
    return df.sort_values(["date", "time_utc", "satellite", "latitude", "longitude"], ignore_index=True)


def build(regions, out=EXTRACT, raw=common.RAW, clean=common.CLEAN, filtered=common.FILTERED, availability=None, log=print):
    out = Path(out)
    (out / "samples").mkdir(parents=True, exist_ok=True)
    daily, cov, samples = [], [], {}
    for region in regions:
        for source in common.SOURCES:
            if not (Path(clean) / region / source).is_dir():
                continue
            daily.append(daily_counts(region, source, clean, filtered))
            c = coverage(region, source, raw, availability)
            if c:
                cov.append(c)
            s = sample_rows(region, source, filtered)
            if s is not None:
                name = f"{region}__{source}.csv"
                s.to_csv(out / "samples" / name, index=False)
                samples[name] = len(s)
            log(f"{region} {source}: {len(daily[-1]):,} day-satellite rows")
    d = pd.concat(daily, ignore_index=True) if daily else pd.DataFrame(columns=DAILY_COLUMNS)
    d.to_csv(out / "daily_counts.csv", index=False)
    pd.DataFrame(cov).to_csv(out / "coverage.csv", index=False)
    manifest = {
        "built_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "regions": regions,
        "daily_counts_rows": len(d),
        "n_clean_total": int(d["n_clean"].sum()) if len(d) else 0,
        "n_kept_total": int(d["n_kept"].sum()) if len(d) else 0,
        "filter": {"types_kept": list(config.FILTER_TYPES_KEPT), "min_confidence": config.FILTER_MIN_CONFIDENCE},
        "samples": samples,
        "note": "Raw detections in the rectangular download boxes, not clipped to region borders, not harmonized.",
    }
    (out / "MANIFEST.json").write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append", choices=list(config.REGIONS))
    p.add_argument("--out", default=str(EXTRACT))
    a = p.parse_args(argv)
    regions = a.region or [r for r in config.ACTIVE_REGIONS if (common.CLEAN / r).is_dir()]
    if not regions:
        raise SystemExit(f"No cleaned data in {common.CLEAN}. Run steps 02 and 03 first (and check Drive is mounted).")
    t0 = time.time()
    m = build(regions, out=a.out)
    print(f"Extract written to {a.out}: daily_counts.csv ({m['daily_counts_rows']:,} rows; "
          f"{m['n_clean_total']:,} cleaned, {m['n_kept_total']:,} kept detections), coverage.csv, "
          f"samples/ ({len(m['samples'])} files), MANIFEST.json. Took {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
