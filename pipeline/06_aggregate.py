"""Step 6 (S17): write the files the website reads (data/processed/), following docs/data-contract.md.

Input:  data/interim/filtered/<REGION>/<SOURCE>/<YEAR>.parquet (from 03_filter.py)
        data/boundaries/regions_ne.geojson
        docs/validation/S16/params.json, choice.json, metrics.csv, terra_only.csv, terra_only_metrics.csv
        (the chosen harmonization and its numbers; refreshed by 05_calibrate.py / 05b_compare_methods.py)
Output: data/processed/
  metadata.json, regions.geojson
  regions/<REGION>/monthly.json, daily.json, baseline.json, hotspots/<YEAR>.csv      (data contract 1.0)
  regions/<REGION>/grid_cells.csv, grid_monthly.csv, harmonization_check.json        (extra files, see below)

How count_harm (MODIS-equivalent detections) is built, day by day (config.HARMONIZE_POLICY = "blend"):
  1. MODIS (Terra + Aqua) and S-NPP VIIRS both have data (20 Jan 2012 - 31 Jul 2026):
     count_harm = 0.5 x observed MODIS + 0.5 x k[calendar month] x S-NPP detections (method A1).
     Both are estimates on the MODIS scale; averaging uses both sensors and halves the conversion error.
  2. Only MODIS, Terra and Aqua both flying (4 Jul 2002 - 19 Jan 2012, and after S-NPP data ends):
     count_harm = observed MODIS detections.
  3. Terra only (1 Nov 2000 - 3 Jul 2002): count_harm = Terra detections x the Terra-only factor (S16).
  4. No MODIS data for that day (after the MODIS record ends, or a known gap): count_harm =
     k[calendar month] x S-NPP detections; NOAA-20 stands in when S-NPP has no data.
  5. No data from any satellite: null.
  With HARMONIZE_POLICY = "modis_first", rule 1 is replaced by rule 2 (VIIRS is then only used in rule 4).
NOAA-20 and NOAA-21 detections are kept in the files (raw counts, map, downloads) with weight 0, except in rule 4.
Every detection gets a harmonized_weight so that the weights of any set of detections add up to its
count_harm. This is what lets the website compute harmonized numbers for any area the user draws.

Extra files (not in data contract 1.0; proposed as an addition, website may ignore them):
  grid_cells.csv            the 0.25-degree cells of the region: lat_idx, lon_idx, centre, share inside the region
  grid_monthly.csv          per month and cell: count_harm, raw MODIS and VIIRS counts, FRP. For fast
                            calendars and anomalies of a user-chosen area without loading every detection.
  harmonization_check.json  per overlap month: observed MODIS next to the MODIS-equivalent from S-NPP and its range

Example:  python3 pipeline/06_aggregate.py        (California; needs the filtered files, about 1 minute)
"""
import argparse
import csv
import datetime as dt
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402

_spec = importlib.util.spec_from_file_location("grid04", Path(__file__).resolve().parent / "04_dedupe_and_grid.py")
grid04 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(grid04)

PROCESSED = common.ROOT / "data" / "processed"
S16 = common.ROOT / "docs" / "validation" / "S16"
SCHEMA_VERSION = "1.0"
AQUA_FIRST = config.SATELLITE_FIRST_DAY["A"]          # 4 July 2002
CITATION = ("We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), "
            "part of the NASA Earth Science Data and Information System (ESDIS).")
COUNTRY = {"US-CA": "United States", "BR-PA": "Brazil", "AU-NSW-VIC": "Australia", "PT": "Portugal"}
HOTSPOT_COLUMNS = ["date", "time_utc", "latitude", "longitude", "sensor", "satellite", "confidence", "frp", "daynight",
                   "harmonized_weight", "region_id"]
TRANSITIONS = [("2000-11-01", "MODIS Terra starts (Terra only until Aqua)"), ("2002-07-04", "MODIS Aqua starts"),
               ("2012-01-20", "S-NPP VIIRS starts"), ("2018-04-01", "NOAA-20 VIIRS starts"),
               ("2023-01-01", "MODIS files switch from collection 6 to 6.1"), ("2023-03-01", "NOAA-21 VIIRS starts")]


def r2(x, nd=2):
    return None if x is None else round(float(x), nd)


def load_harmonization(region, folder=S16):
    """The chosen method's numbers for one region, from the S16 results."""
    folder = Path(folder)
    choice = json.loads((folder / "choice.json").read_text())
    params = json.loads((folder / "params.json").read_text())["regions"][region]
    winner = choice["winner"]
    if winner not in ("A0", "A1"):
        raise SystemExit(f"06_aggregate.py supports methods A0 and A1; S16 chose {winner}.")
    k = params[winner]["k"]
    k_month = {m: float(k[str(m)] if isinstance(k, dict) else k) for m in range(1, 13)}
    band = choice["band_by_region"][region]
    # Terra-only factor: one number (F0) unless the per-month factors (F1) were clearly better on the test years.
    tm = pd.read_csv(folder / "terra_only_metrics.csv")
    tm = tm[tm["region_id"] == region].set_index("method")["mape"]
    use_f1 = bool(tm.get("F1", 1e9) < tm.get("F0", 1e9) - 2.0)
    t = params["terra_only"]
    f_month = {m: float(t["F1"][str(m)]) if use_f1 else float(t["F0"]) for m in range(1, 13)}
    # Range for Terra-only months: middle 80 % of (Terra + Aqua) / estimate over the fitting years.
    to = pd.read_csv(folder / "terra_only.csv")
    to = to[(to["region_id"] == region) & (to["split"] == "train") & (to["M"] >= 10)]
    est = to["month"].map(f_month) * to["T"]
    ratio = (to["M"] / est)[est > 0]
    tb = (float(ratio.quantile(0.10)), float(ratio.quantile(0.90))) if len(ratio) >= 10 else (1.0, 1.0)
    metrics = pd.read_csv(folder / "metrics.csv")
    row = metrics[(metrics["region_id"] == region) & (metrics["method"] == winner)].iloc[0]
    return {"method": winner, "method_version": choice["method_version"], "k_month": k_month,
            "band": (float(band["low_factor"]), float(band["high_factor"])),
            "terra_factor": f_month, "terra_factor_kind": "per calendar month (F1)" if use_f1 else "one factor (F0)",
            "terra_band": (min(tb[0], 1.0), max(tb[1], 1.0)),
            "validation": {"r2": float(row["r2"]), "median_abs_pct_error": float(row["mape"]),
                           "test_years": f"{choice['test_years'][0]}-{choice['test_years'][1]}"}}


def source_ranges(availability=None):
    return {s: common.source_dates(s, availability) for s in common.SOURCES}


def weights(df, h, modis_last, snpp_last, gaps=(), snpp_first=None, policy=None):
    """harmonized_weight per detection (see module docstring). gaps: (first_day, last_day) with no MODIS data."""
    policy = policy or config.HARMONIZE_POLICY
    snpp_first = snpp_first or config.SATELLITE_FIRST_DAY["N"]
    date = pd.to_datetime(df["date"]).dt.date
    month = df["date"].str[5:7].astype(int)
    no_modis = (date > modis_last)
    for a, b in gaps:
        no_modis |= (date >= a) & (date <= b)
    modis = df["sensor"] == "MODIS"
    terra_only = modis & (date < AQUA_FIRST)
    snpp_day = (date >= snpp_first) & (date <= snpp_last)
    # Days where both MODIS (Terra + Aqua) and S-NPP have data: each gives half of the estimate.
    both = snpp_day & ~no_modis & (date >= AQUA_FIRST) if policy == "blend" else pd.Series(False, index=df.index)
    w = pd.Series(0.0, index=df.index)
    w[modis] = 1.0
    w[modis & both] = 0.5
    w[terra_only] = month[terra_only].map(h["terra_factor"])
    stand_in = np.where(date <= snpp_last, "N", "N20")
    conv = (~modis) & no_modis & (df["satellite"] == stand_in)
    w[conv] = month[conv].map(h["k_month"])
    half = (~modis) & both & (df["satellite"] == "N")
    w[half] = 0.5 * month[half].map(h["k_month"])
    kind = pd.Series("modis", index=df.index)
    kind[terra_only] = "terra_only"
    kind[conv | half] = "viirs"
    kind[(~modis) & ~(conv | half)] = "none"
    return w.round(5), kind


def region_points(region, mask, filtered=None):
    """Yield (year, frame) of in-region filtered detections of all sources, with grid indices."""
    filtered = Path(filtered or common.FILTERED)
    years = sorted({int(p.stem) for p in (filtered / region).glob("*/*.parquet")})
    cols = ["date", "time_utc", "latitude", "longitude", "sensor", "satellite", "confidence", "frp", "daynight"]
    for year in years:
        parts = []
        for source in common.SOURCES:
            path = common.year_path(filtered, region, source, year)
            if path.exists():
                d = pd.read_parquet(path, columns=cols)
                sla, slo = grid04.sub_index(d["latitude"].to_numpy(), d["longitude"].to_numpy())
                d = d[mask.contains(sla, slo)].copy()
                d["lat_idx"] = (sla[mask.contains(sla, slo)] // grid04.SUB_PER_CELL).astype("int16")
                d["lon_idx"] = (slo[mask.contains(sla, slo)] // grid04.SUB_PER_CELL).astype("int16")
                d["source"] = source
                parts.append(d)
        if parts:
            df = pd.concat(parts, ignore_index=True)
            yield year, df.sort_values(["date", "time_utc", "satellite", "latitude", "longitude"], kind="mergesort", ignore_index=True)


def polygon_area_km2(polygons):
    """Area on a sphere (radius 6371.0088 km) of a list of polygons [[outer, hole, ...], ...] in lon/lat degrees."""
    def ring(r):
        a = 0.0
        for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
            a += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
        return abs(a) * 6371.0088 ** 2 / 2
    return sum(ring(p[0]) - sum(ring(h) for h in p[1:]) for p in polygons)


def month_list(first, last):
    out, (y, m) = [], (first.year, first.month)
    while (y, m) <= (last.year, last.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def build_region(region, out, h, build_date, filtered=None, availability=None, gaps=(), mask=None, polygons=None, log=print):
    ranges = source_ranges(availability)
    modis_first, modis_last = ranges["MODIS_SP"]
    viirs_first = min(ranges[s][0] for s in common.SOURCES if s.startswith("VIIRS"))
    viirs_last = max(ranges[s][1] for s in common.SOURCES if s.startswith("VIIRS"))
    snpp_last = ranges["VIIRS_SNPP_SP"][1]
    start, end = min(modis_first, viirs_first), max(modis_last, viirs_last)
    polygons = polygons if polygons is not None else grid04.load_polygons(region)
    mask = mask or grid04.RegionMask(region, polygons)
    rdir = Path(out) / "regions" / region
    (rdir / "hotspots").mkdir(parents=True, exist_ok=True)
    for old in (rdir / "hotspots").glob("*.csv"):
        old.unlink()

    daily_parts, cell_parts, n_by_source, range_by_source = [], [], {}, {}
    for year, df in region_points(region, mask, filtered):
        df["harmonized_weight"], df["kind"] = weights(df, h, modis_last, snpp_last, gaps, ranges["VIIRS_SNPP_SP"][0])
        df["region_id"] = region
        hs = df[HOTSPOT_COLUMNS].copy()
        hs["latitude"], hs["longitude"], hs["frp"] = hs["latitude"].round(5), hs["longitude"].round(5), hs["frp"].round(2)
        hs.to_csv(rdir / "hotspots" / f"{year}.csv", index=False)
        df["is_modis"] = (df["sensor"] == "MODIS").astype(int)
        df["is_viirs"] = 1 - df["is_modis"]
        df["is_high"] = (df["confidence"] == "high").astype(int)
        df["frp_modis"], df["frp_viirs"] = df["frp"] * df["is_modis"], df["frp"] * df["is_viirs"]
        for kd in ("modis", "terra_only", "viirs"):
            df[f"w_{kd}"] = df["harmonized_weight"].where(df["kind"] == kd, 0.0)
        agg = dict(count_harm=("harmonized_weight", "sum"), w_modis=("w_modis", "sum"), w_terra_only=("w_terra_only", "sum"),
                   w_viirs=("w_viirs", "sum"), count_raw_modis=("is_modis", "sum"), count_raw_viirs=("is_viirs", "sum"),
                   frp_modis=("frp_modis", "sum"), frp_viirs=("frp_viirs", "sum"), n_high=("is_high", "sum"))
        daily_parts.append(df.groupby("date").agg(**agg))
        sat = df.groupby(["date", "satellite"]).size().unstack(fill_value=0)
        daily_parts[-1] = daily_parts[-1].join(sat.add_prefix("sat_"))
        df["ym"] = df["date"].str[:7]
        cell_parts.append(df.groupby(["ym", "lat_idx", "lon_idx"]).agg(
            count_harm=("harmonized_weight", "sum"), count_raw_modis=("is_modis", "sum"),
            count_raw_viirs=("is_viirs", "sum"), frp_sum=("frp", "sum")).reset_index())
        for s, g in df.groupby("source"):
            n_by_source[s] = n_by_source.get(s, 0) + len(g)
            a, b = range_by_source.get(s, (g["date"].min(), g["date"].max()))
            range_by_source[s] = (min(a, g["date"].min()), max(b, g["date"].max()))
        log(f"  {region} {year}: {len(df):,} detections, count_harm {df['harmonized_weight'].sum():,.1f}")

    days = pd.date_range(start, end, freq="D")
    d = pd.concat(daily_parts).reindex(days.strftime("%Y-%m-%d")).fillna(0.0) if daily_parts else pd.DataFrame(index=days.strftime("%Y-%m-%d"))
    day = np.array([x.date() for x in days])
    has_modis = (day >= modis_first) & (day <= modis_last)
    for a, b in gaps:
        has_modis &= ~((day >= a) & (day <= b))
    has_viirs = (day >= viirs_first) & (day <= viirs_last)
    observed = has_modis | has_viirs

    def col(name, ok, nd=None, integer=False):
        v = d[name].to_numpy() if name in d else np.zeros(len(d))
        return [None if not o else (int(round(x)) if integer else round(float(x), nd)) for x, o in zip(v, ok)]

    frp_total = (d.get("frp_modis", 0) + d.get("frp_viirs", 0))
    d["frp_sum"] = frp_total
    daily_doc = {"schema_version": SCHEMA_VERSION, "method_version": h["method_version"], "is_sample": False, "region_id": region,
                 "build_date": build_date, "start": start.isoformat(), "end": end.isoformat(),
                 "columns": {"count_harm": col("count_harm", observed, 4), "count_raw_modis": col("count_raw_modis", has_modis, integer=True),
                             "count_raw_viirs": col("count_raw_viirs", has_viirs, integer=True), "frp_sum": col("frp_sum", observed, 1)}}
    (rdir / "daily.json").write_text(json.dumps(daily_doc, separators=(",", ":")) + "\n")

    d["ym"] = [f"{x.year}-{x.month:02d}" for x in day]
    d["has_modis"], d["has_viirs"], d["observed"] = has_modis, has_viirs, observed
    months, check = [], []
    name = config.REGIONS[region]["name"]
    for (y, m) in month_list(start, end):
        g = d[d["ym"] == f"{y}-{m:02d}"]
        obs = bool(g["observed"].any())
        gm, gv = g[g["has_modis"]], g[g["has_viirs"]]
        harm = float(g["count_harm"].sum())
        low = float(g["w_modis"].sum() + g["w_terra_only"].sum() * h["terra_band"][0] + g["w_viirs"].sum() * h["band"][0])
        high = float(g["w_modis"].sum() + g["w_terra_only"].sum() * h["terra_band"][1] + g["w_viirs"].sum() * h["band"][1])
        nm, nv = int(gm["count_raw_modis"].sum()), int(gv["count_raw_viirs"].sum())
        sats = {s: int(g[f"sat_{s}"].sum()) for s in ("T", "A", "N", "N20", "N21") if f"sat_{s}" in g and g[f"sat_{s}"].sum() > 0}
        total = nm + nv
        months.append({
            "year": y, "month": m,
            "count_harm": r2(harm) if obs else None, "count_low": r2(min(low, harm)) if obs else None,
            "count_high": r2(max(high, harm)) if obs else None,
            "count_raw_modis": nm if len(gm) else None, "count_raw_viirs": nv if len(gv) else None,
            "raw_by_satellite": sats,
            "frp_sum_modis": r2(gm["frp_modis"].sum(), 1) if len(gm) else None,
            "frp_sum_viirs": r2(gv["frp_viirs"].sum(), 1) if len(gv) else None,
            "share_high_confidence": round(float(g["n_high"].sum()) / total, 4) if total else None,
            "n_days_observed": int(g["observed"].sum())})
        snpp = int(g["sat_N"].sum()) if "sat_N" in g else 0
        if dt.date(y, m, 1) > ranges["VIIRS_SNPP_SP"][0] and (y, m) <= (snpp_last.year, snpp_last.month) and len(gm) == len(g):
            eq = h["k_month"][m] * snpp
            check.append({"year": y, "month": m, "modis_observed": nm, "snpp_detections": snpp, "modis_equivalent_from_snpp": r2(eq),
                          "range_low": r2(eq * h["band"][0]), "range_high": r2(eq * h["band"][1])})
    head = {"schema_version": SCHEMA_VERSION, "method_version": h["method_version"], "is_sample": False, "region_id": region}
    (rdir / "monthly.json").write_text(json.dumps({**head, "region_name": name, "build_date": build_date, "months": months}, separators=(",", ":")) + "\n")

    # Baseline: all complete calendar years with data.
    full_years = [y for y in range(start.year, end.year + 1) if dt.date(y, 1, 1) >= start and dt.date(y, 12, 31) <= end]
    base = []
    for m in range(1, 13):
        vals = np.array([x["count_harm"] for x in months if x["month"] == m and x["year"] in full_years and x["count_harm"] is not None], dtype="float64")
        if len(vals) >= 3:
            q = np.percentile(vals, [10, 25, 50, 75, 90])
            base.append({"month": m, "n_years": int(len(vals)), "mean": r2(vals.mean()), "std": r2(vals.std(ddof=1)),
                         "p10": r2(q[0]), "p25": r2(q[1]), "p50": r2(q[2]), "p75": r2(q[3]), "p90": r2(q[4])})
        else:
            base.append({"month": m, "n_years": int(len(vals)), "mean": None, "std": None, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None})
    (rdir / "baseline.json").write_text(json.dumps({**head, "build_date": build_date,
                                                    "base_period": {"start_year": full_years[0], "end_year": full_years[-1]}, "months": base}, indent=1) + "\n")

    # Extra files for user-chosen areas.
    cells = mask.cells()
    cells[["lat", "lon"]] = cells[["lat", "lon"]].round(3)
    cells[["lat_idx", "lon_idx", "lat", "lon", "share_in_region"]].to_csv(rdir / "grid_cells.csv", index=False)
    gm_ = pd.concat(cell_parts, ignore_index=True) if cell_parts else pd.DataFrame(columns=["ym", "lat_idx", "lon_idx", "count_harm", "count_raw_modis", "count_raw_viirs", "frp_sum"])
    gm_.insert(0, "year", gm_["ym"].str[:4].astype(int))
    gm_.insert(1, "month", gm_["ym"].str[5:7].astype(int))
    gm_ = gm_.drop(columns="ym").sort_values(["year", "month", "lat_idx", "lon_idx"], ignore_index=True)
    gm_["count_harm"], gm_["frp_sum"] = gm_["count_harm"].round(3), gm_["frp_sum"].round(1)
    gm_.to_csv(rdir / "grid_monthly.csv", index=False)
    (rdir / "harmonization_check.json").write_text(json.dumps({
        **head, "build_date": build_date, "method": h["method"], "k_by_calendar_month": {str(k): round(v, 4) for k, v in h["k_month"].items()},
        "range_factors": list(h["band"]), "note": "modis_equivalent_from_snpp = k[month] x S-NPP detections; the range should hold about 80 % of months "
        "(it held fewer on the test years, see docs/validation/README.md). policy: " + config.HARMONIZE_POLICY + ".",
        "months": check}, separators=(",", ":")) + "\n")

    feature = {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": polygons},
               "properties": {"region_id": region, "name": name, "country": COUNTRY.get(region, ""),
                              "area_km2": round(polygon_area_km2(polygons)), "bbox": region_bbox(polygons),
                              "boundary_source": "Natural Earth 10m admin-1 states and provinces (naturalearthdata.com)"}}
    sources = [{"source": s, "first_date": ranges[s][0].isoformat(), "last_date": ranges[s][1].isoformat(),
                "n_detections_kept": int(n_by_source.get(s, 0))} for s in common.SOURCES]
    return {"feature": feature, "sources": sources, "start": start, "end": end, "n_months": len(months),
            "count_harm_total": sum(x["count_harm"] or 0 for x in months), "grid_rows": len(gm_), "gaps": gaps}


def region_bbox(polygons):
    xs = [x for p in polygons for x, _ in p[0]]
    ys = [y for p in polygons for _, y in p[0]]
    return [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]


def build(regions, out=PROCESSED, filtered=None, s16=S16, availability=None, build_date=None, log=print):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    build_date = build_date or dt.date.today().isoformat()
    results, hs = {}, {}
    for region in regions:
        hs[region] = load_harmonization(region, s16)
        log(f"{region}: method {hs[region]['method_version']}, Terra-only factor {hs[region]['terra_factor_kind']}")
        results[region] = build_region(region, out, hs[region], build_date, filtered, availability, log=log)
    first = hs[regions[0]]
    sources = results[regions[0]]["sources"] if len(regions) == 1 else [
        {**s, "n_detections_kept": sum(r["sources"][i]["n_detections_kept"] for r in results.values())}
        for i, s in enumerate(results[regions[0]]["sources"])]
    meta = {"schema_version": SCHEMA_VERSION, "method_version": first["method_version"], "build_date": build_date, "is_sample": False,
            "reference_scale": "MODIS-equivalent detections (Terra + Aqua). " + (
                "From 20 Jan 2012: average of observed MODIS and S-NPP VIIRS converted with a ratio per calendar month. "
                if config.HARMONIZE_POLICY == "blend" else "Observed MODIS where it exists. ")
                + "Before 2012: observed MODIS. Terra-only months (Nov 2000 - 3 Jul 2002) scaled to Terra + Aqua.",
            "time_coverage": {"start": min(r["start"] for r in results.values()).isoformat(), "end": max(r["end"] for r in results.values()).isoformat()},
            "sources": sources,
            "filters": {"min_confidence": config.FILTER_MIN_CONFIDENCE, "types_kept": list(config.FILTER_TYPES_KEPT)},
            "grid_resolution_deg": config.GRID_DEG, "regions": list(regions),
            "sensor_transitions": [{"date": d, "label": l} for d, l in TRANSITIONS],
            "known_gaps": [{"start": a.isoformat(), "end": b.isoformat(), "sensor": "MODIS", "note": "No MODIS data in the FIRMS archive"}
                           for r in results.values() for a, b in r["gaps"]],
            "validation": first["validation"], "citation": CITATION}
    (out / "metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    (out / "regions.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [r["feature"] for r in results.values()]},
                                                    separators=(",", ":")) + "\n")
    return meta, results


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append", choices=list(config.REGIONS))
    p.add_argument("--out", default=str(PROCESSED))
    a = p.parse_args(argv)
    regions = a.region or [r for r in config.ACTIVE_REGIONS if (common.FILTERED / r).is_dir()]
    if not regions:
        raise SystemExit(f"No filtered data for {config.ACTIVE_REGIONS} in {common.FILTERED}. Run steps 02-03 (Colab) or copy the files there.")
    meta, results = build(regions, a.out)
    for region, r in results.items():
        print(f"{region}: {r['n_months']} months, count_harm total {r['count_harm_total']:,.1f}, "
              f"area {r['feature']['properties']['area_km2']:,} km2, grid rows {r['grid_rows']:,}")
    print(f"Wrote {a.out}. Check it with: python3 scripts/validate_data.py {a.out}")


if __name__ == "__main__":
    main()
