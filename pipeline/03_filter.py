"""Step 3 (S12): filter the cleaned detections and count exactly what was removed.

Input:  data/interim/clean/<REGION>/<SOURCE>/<YEAR>.parquet   (from 02_clean.py)
Output: data/interim/filtered/<REGION>/<SOURCE>/<YEAR>.parquet (same columns as the cleaned files)
        data/interim/reports/filter_counts.csv   one row per region, source, year
        data/interim/reports/filter_summary.csv  one row per region and sensor (totals)

Default rules (config.py; also written to metadata.json "filters" by step 06):
  1. keep only `type` in FILTER_TYPES_KEPT (default 0 = vegetation fire)
  2. of those, keep only confidence >= FILTER_MIN_CONFIDENCE (default nominal: drops "low")
Removals are counted in that order, so each removed row is counted once:
  rows_in = removed_type + removed_low_confidence + rows_out   (checked; the script stops if not)

Examples:
  python3 pipeline/03_filter.py
  python3 pipeline/03_filter.py --region PT --min-confidence low     # keep everything except non-vegetation
"""
import argparse
import csv
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402

CONF_RANK = {"low": 0, "nominal": 1, "high": 2}
COUNT_FIELDS = ["region_id", "sensor", "source", "year", "rows_in", "removed_type", "removed_low_confidence",
                "rows_out", "pct_removed", "removed_type_1", "removed_type_2", "removed_type_3"]


def filter_frame(df, min_confidence=config.FILTER_MIN_CONFIDENCE, types_kept=config.FILTER_TYPES_KEPT):
    """Return (kept rows, counts). Each removed row is counted under the first rule it fails."""
    type_ok = df["type"].isin(list(types_kept))
    conf_ok = df["confidence"].map(CONF_RANK) >= CONF_RANK[min_confidence]
    kept = df[type_ok & conf_ok].reset_index(drop=True)
    counts = {
        "rows_in": len(df),
        "removed_type": int((~type_ok).sum()),
        "removed_low_confidence": int((type_ok & ~conf_ok).sum()),
        "rows_out": len(kept),
    }
    for t in (1, 2, 3):
        counts[f"removed_type_{t}"] = int(((df["type"] == t) & ~type_ok).sum())
    if counts["rows_in"] != counts["removed_type"] + counts["removed_low_confidence"] + counts["rows_out"]:
        raise AssertionError(f"filter counts do not add up: {counts}")
    return kept, counts


def pct(removed, total):
    return round(100.0 * removed / total, 2) if total else 0.0


def run(regions, sources, min_confidence, types_kept, clean=common.CLEAN, out=common.FILTERED, log=print):
    rows = []
    for region in regions:
        for source in sources:
            for path in sorted((Path(clean) / region / source).glob("*.parquet")):
                year = int(path.stem)
                df = pd.read_parquet(path)
                kept, c = filter_frame(df, min_confidence, types_kept)
                target = common.year_path(out, region, source, year)
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_suffix(".parquet.part")
                kept.to_parquet(tmp, index=False)
                tmp.replace(target)  # overwrite, never append
                c.update(region_id=region, sensor=config.SENSOR_OF_SOURCE[source], source=source, year=year,
                         pct_removed=pct(c["rows_in"] - c["rows_out"], c["rows_in"]))
                rows.append(c)
    return rows


def write_reports(rows, folder=common.REPORTS, log=print):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (list(config.REGIONS).index(r["region_id"]), r["sensor"], r["source"], r["year"]))
    with (folder / "filter_counts.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COUNT_FIELDS)
        w.writeheader()
        w.writerows({k: r[k] for k in COUNT_FIELDS} for r in rows)
    totals = {}
    for r in rows:
        t = totals.setdefault((r["region_id"], r["sensor"]), {"rows_in": 0, "removed_type": 0, "removed_low_confidence": 0, "rows_out": 0})
        for k in t:
            t[k] += r[k]
    with (folder / "filter_summary.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["region_id", "sensor", "rows_in", "removed_type", "pct_type", "removed_low_confidence",
                    "pct_low_confidence", "rows_out", "pct_removed"])
        for (reg, sen), t in totals.items():
            w.writerow([reg, sen, t["rows_in"], t["removed_type"], pct(t["removed_type"], t["rows_in"]),
                        t["removed_low_confidence"], pct(t["removed_low_confidence"], t["rows_in"]),
                        t["rows_out"], pct(t["rows_in"] - t["rows_out"], t["rows_in"])])
    return rows, totals


def print_tables(rows, totals, log=print):
    log("Totals (removed: non-vegetation type first, then low confidence among the rest):")
    log(f"  {'region':11} {'sensor':6} {'rows in':>11} {'type':>9} {'%':>6} {'low conf':>9} {'%':>6} {'kept':>11} {'% removed':>9}")
    for (reg, sen), t in totals.items():
        log(f"  {reg:11} {sen:6} {t['rows_in']:>11,} {t['removed_type']:>9,} {pct(t['removed_type'], t['rows_in']):>6} "
            f"{t['removed_low_confidence']:>9,} {pct(t['removed_low_confidence'], t['rows_in']):>6} {t['rows_out']:>11,} "
            f"{pct(t['rows_in'] - t['rows_out'], t['rows_in']):>9}")
    log("Removed per sensor per year (% of that year's rows):")
    per = {}
    for r in rows:
        k = (r["region_id"], r["year"])
        p = per.setdefault(k, {})
        s = p.setdefault(r["sensor"], [0, 0])
        s[0] += r["rows_in"]
        s[1] += r["rows_in"] - r["rows_out"]
    for reg in dict.fromkeys(r["region_id"] for r in rows):
        log(f"  {reg}")
        for (rg, y) in sorted(per):
            if rg == reg:
                log(f"    {y}  " + "   ".join(f"{sen:5} {v[1]:>8,} of {v[0]:>9,} ({pct(v[1], v[0]):5.1f}%)"
                                         for sen, v in sorted(per[(reg, y)].items())))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append", choices=list(config.REGIONS))
    p.add_argument("--sources", nargs="+", choices=common.SOURCES, default=list(common.SOURCES))
    p.add_argument("--min-confidence", choices=list(CONF_RANK), default=config.FILTER_MIN_CONFIDENCE)
    p.add_argument("--types", nargs="+", type=int, default=list(config.FILTER_TYPES_KEPT), help="type values to keep")
    a = p.parse_args(argv)
    regions = a.region or [r for r in config.REGIONS if (common.CLEAN / r).is_dir()]
    if not regions:
        raise SystemExit(f"No cleaned data in {common.CLEAN}. Run step 02 first.")
    t0 = time.time()
    print(f"Filter: keep type in {a.types}, confidence >= {a.min_confidence}")
    rows = run(regions, a.sources, a.min_confidence, a.types)
    rows, totals = write_reports(rows)
    print_tables(rows, totals)
    print(f"Reports: {common.REPORTS}/filter_counts.csv, filter_summary.csv. Took {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
