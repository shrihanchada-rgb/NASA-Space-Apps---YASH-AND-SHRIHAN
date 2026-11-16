"""Check a data folder against docs/data-contract.md and docs/schemas/.

Works for web/fixtures/ (sample data) and data/processed/ (real pipeline output).

Run:  python3 scripts/validate_data.py web/fixtures
Exit code 0 = valid; 1 = problems found (each is printed).
"""
import csv
import datetime as dt
import json
import re
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "docs" / "schemas"
TOL = 1e-3


def load_schema(name):
    return Draft202012Validator(json.loads((SCHEMAS / f"{name}.schema.json").read_text()))


def check_schema(errors, validator, path):
    try:
        doc = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        errors.append(f"{path}: cannot read JSON ({e})")
        return None
    for err in validator.iter_errors(doc):
        errors.append(f"{path}: {'/'.join(map(str, err.path)) or '(top)'}: {err.message}")
    return doc


def close(a, b):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= TOL * max(1.0, abs(a), abs(b))


def validate(folder):
    folder = Path(folder)
    errors = []
    meta = check_schema(errors, load_schema("metadata"), folder / "metadata.json")
    regions = check_schema(errors, load_schema("regions"), folder / "regions.geojson")
    if meta is None or regions is None:
        return errors
    sample = meta["is_sample"]
    feature_ids = [f["properties"]["region_id"] for f in regions["features"]]
    for rid in meta["regions"]:
        if rid not in feature_ids:
            errors.append(f"metadata.regions has {rid} but regions.geojson does not")
    for f in regions["features"]:
        w, s, e, n = f["properties"]["bbox"]
        if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
            errors.append(f"regions.geojson {f['properties']['region_id']}: bad bbox {f['properties']['bbox']}")

    spec = json.loads((SCHEMAS / "hotspots_csv.schema.json").read_text())["columns"]
    for rid in meta["regions"]:
        rdir = folder / "regions" / rid
        p = f"regions/{rid}"
        monthly = check_schema(errors, load_schema("monthly"), rdir / "monthly.json")
        daily = check_schema(errors, load_schema("daily"), rdir / "daily.json")
        base = check_schema(errors, load_schema("baseline"), rdir / "baseline.json")
        if None in (monthly, daily, base):
            continue
        for name, doc in (("monthly", monthly), ("daily", daily), ("baseline", base)):
            if doc["is_sample"] != sample:
                errors.append(f"{p}/{name}.json: is_sample differs from metadata.json")
            if doc["region_id"] != rid:
                errors.append(f"{p}/{name}.json: region_id {doc['region_id']} != folder {rid}")

        # monthly: contiguous months, band order
        ms = monthly["months"]
        for a, b in zip(ms, ms[1:]):
            exp = (a["year"] + (a["month"] == 12), a["month"] % 12 + 1)
            if (b["year"], b["month"]) != exp:
                errors.append(f"{p}/monthly.json: gap or order error after {a['year']}-{a['month']:02d}")
        for m in ms:
            if m["count_harm"] is not None and not (m["count_low"] <= m["count_harm"] <= m["count_high"]):
                errors.append(f"{p}/monthly.json {m['year']}-{m['month']:02d}: need count_low <= count_harm <= count_high")

        # daily: equal lengths matching start..end
        start, end = dt.date.fromisoformat(daily["start"]), dt.date.fromisoformat(daily["end"])
        ndays = (end - start).days + 1
        for k, v in daily["columns"].items():
            if len(v) != ndays:
                errors.append(f"{p}/daily.json: column {k} has {len(v)} values, expected {ndays}")
        if any(len(v) != ndays for v in daily["columns"].values()):
            continue

        # daily sums must match monthly
        agg = {}
        for i in range(ndays):
            d = start + dt.timedelta(days=i)
            a = agg.setdefault((d.year, d.month), {"count_harm": [], "count_raw_modis": [], "count_raw_viirs": []})
            for k in a:
                a[k].append(daily["columns"][k][i])
        for m in ms:
            a = agg.get((m["year"], m["month"]))
            if a is None:
                continue
            for k in ("count_harm", "count_raw_modis", "count_raw_viirs"):
                vals = [x for x in a[k] if x is not None]
                total = sum(vals) if vals else None
                if not close(total, m[k]):
                    errors.append(f"{p} {m['year']}-{m['month']:02d}: {k} monthly={m[k]} but daily sum={total}")

        # baseline months 1..12 and nulls when n_years < 3
        if [b["month"] for b in base["months"]] != list(range(1, 13)):
            errors.append(f"{p}/baseline.json: months must be 1..12 in order")
        for b in base["months"]:
            if b["n_years"] < 3 and b["mean"] is not None:
                errors.append(f"{p}/baseline.json month {b['month']}: fewer than 3 years must give null values")

        # hotspot CSVs: columns, values, and totals vs monthly
        hdir = rdir / "hotspots"
        names = [c["name"] for c in spec]
        counted = {}
        for fpath in sorted(hdir.glob("*.csv")) if hdir.is_dir() else []:
            with open(fpath, newline="") as f:
                rd = csv.DictReader(f)
                if rd.fieldnames != names:
                    errors.append(f"{fpath}: columns {rd.fieldnames} != {names}")
                    continue
                for ln, row in enumerate(rd, start=2):
                    bad = [c["name"] for c in spec if not ok_value(row[c["name"]], c)]
                    if bad:
                        errors.append(f"{fpath}:{ln}: bad value in {bad}")
                        continue
                    if row["region_id"] != rid or not row["date"].startswith(fpath.stem):
                        errors.append(f"{fpath}:{ln}: wrong region or year for this file")
                    key = (int(row["date"][:4]), int(row["date"][5:7]))
                    c = counted.setdefault(key, {"MODIS": 0, "VIIRS": 0, "w": 0.0})
                    c[row["sensor"]] += 1
                    c["w"] += float(row["harmonized_weight"])
        if counted:
            for m in ms:
                c = counted.get((m["year"], m["month"]), {"MODIS": 0, "VIIRS": 0, "w": 0.0})
                if m["count_harm"] is None:
                    if c["MODIS"] or c["VIIRS"]:
                        errors.append(f"{p} {m['year']}-{m['month']:02d}: hotspots exist but month is null")
                    continue
                # A null raw count means "that sensor had no data this month": then there must be no rows of it.
                if (m["count_raw_modis"] or 0) != c["MODIS"] or (m["count_raw_viirs"] or 0) != c["VIIRS"]:
                    errors.append(f"{p} {m['year']}-{m['month']:02d}: hotspot rows (MODIS {c['MODIS']}, VIIRS {c['VIIRS']}) != monthly raw counts")
                if not close(c["w"], m["count_harm"]):
                    errors.append(f"{p} {m['year']}-{m['month']:02d}: sum of harmonized_weight {c['w']:.4f} != count_harm {m['count_harm']}")
        # area files (contract section 8): grid cells and per-cell monthly counts must add up to monthly.json
        gpath, cpath = rdir / "grid_monthly.csv", rdir / "grid_cells.csv"
        if not gpath.exists() or not cpath.exists():
            errors.append(f"{p}: grid_monthly.csv and grid_cells.csv are required (contract section 8)")
            continue
        with open(cpath, newline="") as f:
            rd = csv.DictReader(f)
            if rd.fieldnames != ["lat_idx", "lon_idx", "lat", "lon", "share_in_region"]:
                errors.append(f"{cpath}: columns {rd.fieldnames}")
                continue
            cells = {(int(r["lat_idx"]), int(r["lon_idx"])) for r in rd}
        sums, seen = {}, set()
        with open(gpath, newline="") as f:
            rd = csv.DictReader(f)
            if rd.fieldnames != ["year", "month", "lat_idx", "lon_idx", "count_harm", "count_raw_modis", "count_raw_viirs", "frp_sum"]:
                errors.append(f"{gpath}: columns {rd.fieldnames}")
                continue
            for ln, r in enumerate(rd, start=2):
                key = (int(r["year"]), int(r["month"]), int(r["lat_idx"]), int(r["lon_idx"]))
                if key in seen:
                    errors.append(f"{gpath}:{ln}: cell-month listed twice")
                seen.add(key)
                if key[2:] not in cells:
                    errors.append(f"{gpath}:{ln}: cell {key[2:]} is not in grid_cells.csv")
                a = sums.setdefault(key[:2], [0.0, 0, 0])
                a[0] += float(r["count_harm"])
                a[1] += int(r["count_raw_modis"])
                a[2] += int(r["count_raw_viirs"])
        for m in ms:
            a = sums.get((m["year"], m["month"]), [0.0, 0, 0])
            if m["count_harm"] is None:
                if a != [0.0, 0, 0]:
                    errors.append(f"{p} {m['year']}-{m['month']:02d}: grid rows exist but month is null")
                continue
            if abs(a[0] - m["count_harm"]) > 0.05 + 1e-5 * m["count_harm"]:
                errors.append(f"{p} {m['year']}-{m['month']:02d}: grid count_harm sum {a[0]:.3f} != monthly {m['count_harm']}")
            if a[1] != (m["count_raw_modis"] or 0) or a[2] != (m["count_raw_viirs"] or 0):
                errors.append(f"{p} {m['year']}-{m['month']:02d}: grid raw counts {a[1:]} != monthly")
    return errors


def ok_value(v, c):
    if "enum" in c:
        return v in c["enum"]
    if "pattern" in c:
        return re.fullmatch(c["pattern"], v) is not None
    try:
        x = float(v)
    except ValueError:
        return False
    return c.get("min", -1e300) <= x <= c.get("max", 1e300)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/validate_data.py <folder>")
    errs = validate(sys.argv[1])
    for e in errs:
        print("ERROR", e)
    print(f"{len(errs)} problem(s) in {sys.argv[1]}")
    sys.exit(1 if errs else 0)
