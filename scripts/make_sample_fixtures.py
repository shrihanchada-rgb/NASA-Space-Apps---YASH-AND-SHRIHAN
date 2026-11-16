"""Generate FAKE sample files in web/fixtures/ that follow docs/data-contract.md.

Step S08 (extended 2026-11-15 for S21-S24). Every count here is invented (random with a fixed seed) so the
website can be built and tested without real data. All JSON files carry "is_sample": true. Do not use for analysis.

The region outline is California's real outline (data/boundaries/regions_ne.geojson, Natural Earth), so map,
drawing and clipping behave as they will on real data. Fake points are placed inside that outline only.
Also written: grid_cells.csv and grid_monthly.csv (data contract section 8), built with the same code as the
real pipeline (pipeline/04_dedupe_and_grid.py), so per-area calendars and charts can be tested.

Run:  python3 scripts/make_sample_fixtures.py
"""
import csv
import datetime as dt
import json
import math
import random
import importlib.util
import statistics
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "fixtures"
REGION_ID, REGION_NAME, COUNTRY = "US-CA", "California", "United States"
START, END = dt.date(2015, 1, 1), dt.date(2025, 12, 31)
BUILD_DATE = "2026-11-14"
SAMPLE_METHOD = "none"
OUTAGE = (dt.date(2024, 6, 1), dt.date(2024, 6, 30))  # fake: whole month with no data -> nulls
ZERO_MONTH = (2023, 2)  # fake: observed but no fires -> zeros
BIG_YEAR = 2020         # fake: a much bigger fire year, so anomaly colours have something to show
HOTSPOTS = [(-121.6, 39.8), (-122.6, 40.9), (-120.2, 37.6), (-117.3, 34.2), (-119.4, 36.0), (-123.2, 41.6)]  # fake fire centres

sys.path.insert(0, str(ROOT / "pipeline"))
_spec = importlib.util.spec_from_file_location("grid04", ROOT / "pipeline" / "04_dedupe_and_grid.py")
grid04 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(grid04)
POLYGONS = grid04.load_polygons(REGION_ID)
MASK = grid04.RegionMask(REGION_ID, POLYGONS)
XS = [x for p in POLYGONS for x, _ in p[0]]
YS = [y for p in POLYGONS for _, y in p[0]]
BBOX = [round(min(XS), 4), round(min(YS), 4), round(max(XS), 4), round(max(YS), 4)]
NOAA21_START = dt.date(2024, 1, 17)  # real date (docs/data-notes.md)
WEIGHT = {"MODIS": 1.0, "VIIRS": 0.25}  # fake harmonization weights
CITATION = ("We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), "
            "part of the NASA Earth Science Data and Information System (ESDIS).")


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


def season(d):
    # fake fire season peaking in August
    return max(0.0, math.cos((d.timetuple().tm_yday - 225) / 365 * 2 * math.pi)) ** 3


def inside(lon, lat):
    la, lo = grid04.sub_index([lat], [lon])
    return bool(MASK.contains(la, lo)[0])


def place(rng):
    """A fake point inside California: near one of the fake fire centres, or anywhere (25 %)."""
    while True:
        if rng.random() < 0.25:
            lon, lat = rng.uniform(BBOX[0], BBOX[2]), rng.uniform(BBOX[1], BBOX[3])
        else:
            cx, cy = rng.choice(HOTSPOTS)
            lon, lat = rng.gauss(cx, 0.35), rng.gauss(cy, 0.25)
        if inside(lon, lat):
            return round(lat, 4), round(lon, 4)


def make_detections(rng):
    rows = []
    for d in days(START, END):
        if OUTAGE[0] <= d <= OUTAGE[1] or (d.year, d.month) == ZERO_MONTH:
            continue
        lam = (0.05 + 3.0 * season(d)) * (2.5 if d.year == BIG_YEAR else 0.6 + 0.08 * (d.year % 7))
        for sensor, sats in (("MODIS", ["T", "A"]), ("VIIRS", ["N"] + (["N20"] if d.year >= 2018 else []) + (["N21"] if d >= NOAA21_START else []))):
            n = sum(1 for _ in range(int(lam * (4 if sensor == "VIIRS" else 1) * 3)) if rng.random() < 1 / 3)
            for _ in range(n):
                frp = round(rng.lognormvariate(2.0, 1.0), 1)
                conf = rng.choices(["low", "nominal", "high"], [0.0, 0.7, 0.3])[0]  # low already filtered out
                lat, lon = place(rng)
                rows.append({
                    "date": d.isoformat(),
                    "time_utc": f"{rng.choice([9, 10, 18, 20, 21]):02d}{rng.randrange(60):02d}",
                    "latitude": lat,
                    "longitude": lon,
                    "sensor": sensor,
                    "satellite": rng.choice(sats),
                    "confidence": conf,
                    "frp": frp,
                    "daynight": rng.choice(["D", "N"]),
                    "harmonized_weight": WEIGHT[sensor],
                    "region_id": REGION_ID,
                })
    rows.sort(key=lambda r: (r["date"], r["time_utc"]))
    return rows


def observed(d):
    return not (OUTAGE[0] <= d <= OUTAGE[1])


def main():
    rng = random.Random(20261114)
    det = make_detections(rng)
    by_day = {}
    for r in det:
        by_day.setdefault(r["date"], []).append(r)

    # daily.json
    all_days = list(days(START, END))
    cols = {"count_harm": [], "count_raw_modis": [], "count_raw_viirs": [], "frp_sum": []}
    for d in all_days:
        if not observed(d):
            for k in cols:
                cols[k].append(None)
            continue
        rs = by_day.get(d.isoformat(), [])
        cols["count_harm"].append(round(sum(r["harmonized_weight"] for r in rs), 4))
        cols["count_raw_modis"].append(sum(r["sensor"] == "MODIS" for r in rs))
        cols["count_raw_viirs"].append(sum(r["sensor"] == "VIIRS" for r in rs))
        cols["frp_sum"].append(round(sum(r["frp"] for r in rs), 1))
    daily = {"schema_version": "1.0", "method_version": SAMPLE_METHOD, "is_sample": True, "region_id": REGION_ID,
             "build_date": BUILD_DATE, "start": START.isoformat(), "end": END.isoformat(), "columns": cols}

    # monthly.json
    months = []
    for y in range(START.year, END.year + 1):
        for m in range(1, 13):
            ds = [d for d in all_days if d.year == y and d.month == m]
            n_obs = sum(observed(d) for d in ds)
            if n_obs == 0:
                months.append({"year": y, "month": m, "count_harm": None, "count_low": None, "count_high": None,
                               "count_raw_modis": None, "count_raw_viirs": None, "raw_by_satellite": {},
                               "frp_sum_modis": None, "frp_sum_viirs": None, "share_high_confidence": None,
                               "n_days_observed": 0})
                continue
            rs = [r for d in ds for r in by_day.get(d.isoformat(), [])]
            harm = round(sum(r["harmonized_weight"] for r in rs), 4)
            sats = {}
            for r in rs:
                sats[r["satellite"]] = sats.get(r["satellite"], 0) + 1
            months.append({
                "year": y, "month": m,
                "count_harm": harm, "count_low": round(harm * 0.9, 4), "count_high": round(harm * 1.1, 4),
                "count_raw_modis": sum(r["sensor"] == "MODIS" for r in rs),
                "count_raw_viirs": sum(r["sensor"] == "VIIRS" for r in rs),
                "raw_by_satellite": dict(sorted(sats.items())),
                "frp_sum_modis": round(sum(r["frp"] for r in rs if r["sensor"] == "MODIS"), 1),
                "frp_sum_viirs": round(sum(r["frp"] for r in rs if r["sensor"] == "VIIRS"), 1),
                "share_high_confidence": round(sum(r["confidence"] == "high" for r in rs) / len(rs), 4) if rs else None,
                "n_days_observed": n_obs,
            })
    monthly = {"schema_version": "1.0", "method_version": SAMPLE_METHOD, "is_sample": True, "region_id": REGION_ID,
               "region_name": REGION_NAME, "build_date": BUILD_DATE, "months": months}

    # baseline.json (contract: fewer than 3 years -> null values)
    bmonths = []
    for m in range(1, 13):
        vals = sorted(x["count_harm"] for x in months if x["month"] == m and x["count_harm"] is not None)
        if len(vals) < 3:
            bmonths.append({"month": m, "n_years": len(vals), **{k: None for k in ["mean", "std", "p10", "p25", "p50", "p75", "p90"]}})
            continue
        q = statistics.quantiles(vals, n=20, method="inclusive")  # 5% steps
        bmonths.append({"month": m, "n_years": len(vals), "mean": round(statistics.mean(vals), 4),
                        "std": round(statistics.stdev(vals), 4), "p10": round(q[1], 4), "p25": round(q[4], 4),
                        "p50": round(q[9], 4), "p75": round(q[14], 4), "p90": round(q[17], 4)})
    baseline = {"schema_version": "1.0", "method_version": SAMPLE_METHOD, "is_sample": True, "region_id": REGION_ID,
                "build_date": BUILD_DATE, "base_period": {"start_year": START.year, "end_year": END.year}, "months": bmonths}

    # regions.geojson: California's real outline (the counts are fake, the outline is not)
    def ring_area(r):
        a = 0.0
        for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
            a += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
        return abs(a) * 6371.0088 ** 2 / 2
    area = sum(ring_area(p[0]) - sum(ring_area(q) for q in p[1:]) for p in POLYGONS)
    regions = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "geometry": {"type": "MultiPolygon", "coordinates": POLYGONS},
        "properties": {"region_id": REGION_ID, "name": REGION_NAME, "country": COUNTRY,
                       "area_km2": round(area), "bbox": BBOX,
                       "boundary_source": "Natural Earth 10m admin-1 (real outline; the fire counts in this sample are invented)"}}]}

    def src(sensor, sats, name):
        rs = [r for r in det if r["sensor"] == sensor and r["satellite"] in sats]
        return {"source": name, "first_date": rs[0]["date"], "last_date": rs[-1]["date"], "n_detections_kept": len(rs)}

    metadata = {
        "schema_version": "1.0", "method_version": SAMPLE_METHOD, "build_date": BUILD_DATE, "is_sample": True,
        "reference_scale": "MODIS-equivalent detections (SAMPLE: invented values)",
        "time_coverage": {"start": START.isoformat(), "end": END.isoformat()},
        "sources": [src("MODIS", {"T", "A"}, "MODIS_SP"), src("VIIRS", {"N"}, "VIIRS_SNPP_SP"),
                    src("VIIRS", {"N20"}, "VIIRS_NOAA20_SP"), src("VIIRS", {"N21"}, "VIIRS_NOAA21_SP")],
        "filters": {"min_confidence": "nominal", "types_kept": [0]},
        "grid_resolution_deg": 0.25,
        "regions": [REGION_ID],
        "sensor_transitions": [{"date": "2018-04-01", "label": "NOAA-20 VIIRS starts"},
                               {"date": NOAA21_START.isoformat(), "label": "NOAA-21 VIIRS starts"}],
        "known_gaps": [{"start": OUTAGE[0].isoformat(), "end": OUTAGE[1].isoformat(), "sensor": "all",
                        "note": "SAMPLE: invented outage to test hatching"}],
        "validation": {"r2": None, "median_abs_pct_error": None, "test_years": "none (sample data)"},
        "citation": CITATION,
    }

    rdir = OUT / "regions" / REGION_ID
    (rdir / "hotspots").mkdir(parents=True, exist_ok=True)
    for name, obj in [(OUT / "metadata.json", metadata), (OUT / "regions.geojson", regions),
                      (rdir / "monthly.json", monthly), (rdir / "daily.json", daily), (rdir / "baseline.json", baseline)]:
        name.write_text(json.dumps(obj, indent=1) + "\n")
    fields = ["date", "time_utc", "latitude", "longitude", "sensor", "satellite", "confidence", "frp", "daynight",
              "harmonized_weight", "region_id"]
    for old in (rdir / "hotspots").glob("*.csv"):
        old.unlink()
    for key in sorted({r["date"][:7] for r in det}):   # one file per month (contract section 7)
        with open(rdir / "hotspots" / f"{key}.csv", "w", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=fields)
            wr.writeheader()
            wr.writerows(r for r in det if r["date"].startswith(key))
    # grid_cells.csv and grid_monthly.csv (data contract section 8)
    cells = MASK.cells()
    cells[["lat", "lon"]] = cells[["lat", "lon"]].round(3)
    cells[["lat_idx", "lon_idx", "lat", "lon", "share_in_region"]].to_csv(rdir / "grid_cells.csv", index=False)
    agg = {}
    for r in det:
        la, lo = grid04.sub_index([r["latitude"]], [r["longitude"]])
        key = (int(r["date"][:4]), int(r["date"][5:7]), int(la[0]) // grid04.SUB_PER_CELL, int(lo[0]) // grid04.SUB_PER_CELL)
        a = agg.setdefault(key, [0.0, 0, 0, 0.0])
        a[0] += r["harmonized_weight"]
        a[1] += r["sensor"] == "MODIS"
        a[2] += r["sensor"] == "VIIRS"
        a[3] += r["frp"]
    with open(rdir / "grid_monthly.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["year", "month", "lat_idx", "lon_idx", "count_harm", "count_raw_modis", "count_raw_viirs", "frp_sum"])
        for k in sorted(agg):
            v = agg[k]
            wr.writerow([*k, round(v[0], 3), v[1], v[2], round(v[3], 1)])
    print(f"Wrote SAMPLE fixtures to {OUT} ({len(det)} fake detections, {len(agg)} cell-months)")


if __name__ == "__main__":
    main()
