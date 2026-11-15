"""Step 4 (S14): clip the filtered detections to the real region outline and count them on a grid.

Input:  data/interim/filtered/<REGION>/<SOURCE>/<YEAR>.parquet   (from 03_filter.py)
        data/boundaries/regions_ne.geojson                        (Natural Earth outlines, committed)
Output: data/interim/grid/daily/<REGION>/<YEAR>.parquet    one row per day, 0.25-degree cell, satellite
        data/interim/grid/monthly/<REGION>__<SATELLITE>.parquet one row per month and cell (T, A, N, N20, N21)
        data/interim/grid/region_monthly.csv               one row per region, month, satellite (small)
        data/interim/grid/region_cells.csv                 cells of each region (centre, share of cell inside)
        data/interim/reports/grid_summary.csv              rows in / outside region / gridded, per file

Columns of the grid files:
  n            detections (every filtered, in-region detection is counted exactly once)
  n_night      of those, night detections
  n_px1km      distinct ~1 km boxes (0.01 degree) with at least one detection, per day, satellite and
               day/night half. This is the "dedupe" count: several pixels of one satellite in the same
               ~1 km box count once. For VIIRS (375 m pixels) it is Candidate B's MODIS-footprint count.
  frp_sum      sum of FRP (MW)
  days_active  (monthly files) days with at least one detection

No double counting: each detection falls in exactly one day, one cell and one satellite row. The script
checks rows in = rows outside the region + sum of n, and stops if not. Outputs are overwritten.

Clipping: a point is "in the region" when the centre of its 0.01-degree box is inside the outline
(precision about 1 km at the border). Dates are UTC days, as in FIRMS.

Examples:
  python3 pipeline/04_dedupe_and_grid.py            # all regions (Colab: STEPS = ["04"])
  python3 pipeline/04_dedupe_and_grid.py --region PT
"""
import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402

GRID = common.INTERIM / "grid"
BOUNDARIES = common.ROOT / "data" / "boundaries" / "regions_ne.geojson"
SUB_PER_DEG = round(1 / config.SUBGRID_DEG)            # 100 sub-boxes per degree
SUB_PER_CELL = round(config.GRID_DEG / config.SUBGRID_DEG)  # 25 sub-boxes per cell side
KEYS = ["date", "lat_idx", "lon_idx", "satellite"]


def sub_index(lat, lon):
    """Index of the 0.01-degree box of each point, from the south pole / date line. Exact for 5-decimal input."""
    la = np.floor(np.round((np.asarray(lat, dtype="float64") + 90.0) * 1e5) / (1e5 / SUB_PER_DEG)).astype("int32")
    lo = np.floor(np.round((np.asarray(lon, dtype="float64") + 180.0) * 1e5) / (1e5 / SUB_PER_DEG)).astype("int32")
    return la, lo


def cell_id(lat_idx, lon_idx):
    return f"{int(lat_idx)}_{int(lon_idx)}"


def cell_centre(lat_idx, lon_idx):
    return (lat_idx + 0.5) * config.GRID_DEG - 90.0, (lon_idx + 0.5) * config.GRID_DEG - 180.0


def load_polygons(region, path=BOUNDARIES):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    for f in data["features"]:
        if f["properties"]["region_id"] == region:
            return f["geometry"]["coordinates"]
    raise SystemExit(f"No outline for {region} in {path}")


class RegionMask:
    """True/False for every 0.01-degree box in the download box: is its centre inside the region outline?"""

    def __init__(self, region, polygons=None, bbox=None):
        from matplotlib.path import Path as MplPath
        polygons = polygons if polygons is not None else load_polygons(region)
        w, s, e, n = bbox or config.REGIONS[region]["bbox"]
        self.la0, self.lo0 = (int(v[0]) for v in sub_index([s], [w]))
        la1, lo1 = (int(v[0]) for v in sub_index([n], [e]))
        self.shape = (la1 - self.la0 + 1, lo1 - self.lo0 + 1)
        lats = (np.arange(self.la0, la1 + 1) + 0.5) / SUB_PER_DEG - 90.0
        lons = (np.arange(self.lo0, lo1 + 1) + 0.5) / SUB_PER_DEG - 180.0
        mask = np.zeros(self.shape, dtype=bool)
        for poly in polygons:
            outer = np.asarray(poly[0], dtype="float64")
            # only test the part of the grid inside this polygon's own bounding box
            i0, i1 = np.searchsorted(lats, [outer[:, 1].min(), outer[:, 1].max()])
            j0, j1 = np.searchsorted(lons, [outer[:, 0].min(), outer[:, 0].max()])
            if i0 == i1 or j0 == j1:
                continue
            gx, gy = np.meshgrid(lons[j0:j1], lats[i0:i1])
            pts = np.column_stack([gx.ravel(), gy.ravel()])
            inside = MplPath(outer).contains_points(pts)
            for hole in poly[1:]:
                inside &= ~MplPath(np.asarray(hole, dtype="float64")).contains_points(pts)
            mask[i0:i1, j0:j1] |= inside.reshape(i1 - i0, j1 - j0)
        self.mask = mask

    def contains(self, sub_lat, sub_lon):
        i, j = sub_lat - self.la0, sub_lon - self.lo0
        ok = (i >= 0) & (i < self.shape[0]) & (j >= 0) & (j < self.shape[1])
        out = np.zeros(len(i), dtype=bool)
        out[ok] = self.mask[i[ok], j[ok]]
        return out

    def cells(self):
        """Cells with at least one in-region sub-box: lat_idx, lon_idx, centre, share of the cell inside."""
        ii, jj = np.nonzero(self.mask)
        df = pd.DataFrame({"lat_idx": (ii + self.la0) // SUB_PER_CELL, "lon_idx": (jj + self.lo0) // SUB_PER_CELL})
        c = df.groupby(["lat_idx", "lon_idx"]).size().rename("n_sub").reset_index()
        c["share_in_region"] = (c["n_sub"] / (SUB_PER_CELL * SUB_PER_CELL)).round(4)
        c["lat"], c["lon"] = cell_centre(c["lat_idx"], c["lon_idx"])
        return c.drop(columns="n_sub")


def grid_frame(df, mask):
    """Clip and count one frame of filtered detections. Returns (daily grid rows, rows_in, rows_outside)."""
    rows_in = len(df)
    if rows_in == 0:
        return pd.DataFrame(columns=KEYS + ["sensor", "n", "n_night", "n_px1km", "frp_sum"]), 0, 0
    sla, slo = sub_index(df["latitude"].to_numpy(), df["longitude"].to_numpy())
    keep = mask.contains(sla, slo)
    d = pd.DataFrame({
        "date": df["date"].to_numpy()[keep], "satellite": df["satellite"].to_numpy()[keep],
        "sensor": df["sensor"].to_numpy()[keep], "night": (df["daynight"].to_numpy()[keep] == "N"),
        "frp": df["frp"].to_numpy()[keep], "sla": sla[keep], "slo": slo[keep],
    })
    d["lat_idx"] = d["sla"] // SUB_PER_CELL
    d["lon_idx"] = d["slo"] // SUB_PER_CELL
    d["n"] = 1
    d["n_night"] = d["night"].astype("int32")
    base = d.groupby(KEYS, sort=False).agg(sensor=("sensor", "first"), n=("n", "sum"), n_night=("n_night", "sum"),
                                           frp_sum=("frp", "sum"))
    px = d.drop_duplicates(KEYS + ["night", "sla", "slo"]).groupby(KEYS, sort=False).size().rename("n_px1km")
    out = base.join(px).reset_index()
    out["frp_sum"] = out["frp_sum"].round(1)
    out = out[KEYS + ["sensor", "n", "n_night", "n_px1km", "frp_sum"]].sort_values(KEYS, ignore_index=True)
    return out, rows_in, rows_in - int(keep.sum())


def to_monthly(daily):
    if daily.empty:
        return pd.DataFrame(columns=["year", "month", "lat_idx", "lon_idx", "satellite", "sensor", "n", "n_night",
                                     "n_px1km", "frp_sum", "days_active"])
    d = daily.assign(year=daily["date"].str[:4].astype("int16"), month=daily["date"].str[5:7].astype("int8"))
    m = d.groupby(["year", "month", "lat_idx", "lon_idx", "satellite"], sort=True).agg(
        sensor=("sensor", "first"), n=("n", "sum"), n_night=("n_night", "sum"), n_px1km=("n_px1km", "sum"),
        frp_sum=("frp_sum", "sum"), days_active=("date", "nunique")).reset_index()
    m["frp_sum"] = m["frp_sum"].round(1)
    return m


def compact(df):
    for c in ("lat_idx", "lon_idx"):
        df[c] = df[c].astype("int16")
    for c in ("n", "n_night", "n_px1km"):
        df[c] = df[c].astype("int32")
    if "days_active" in df:
        df["days_active"] = df["days_active"].astype("int8")
    return df


def run_region(region, filtered=None, out=None, mask=None, log=print):
    filtered, out = filtered or common.FILTERED, out or GRID
    mask = mask or RegionMask(region)
    years = sorted({int(p.stem) for p in (Path(filtered) / region).glob("*/*.parquet")})
    summary, monthly = [], []
    for year in years:
        parts, per_source = [], []
        for source in common.SOURCES:
            path = common.year_path(filtered, region, source, year)
            if not path.exists():
                continue
            df = pd.read_parquet(path, columns=["date", "satellite", "sensor", "latitude", "longitude", "daynight", "frp"])
            g, rows_in, outside = grid_frame(df, mask)
            gridded = int(g["n"].sum()) if len(g) else 0
            if rows_in != outside + gridded:
                raise SystemExit(f"{region} {source} {year}: rows in {rows_in} != outside {outside} + gridded {gridded}")
            summary.append({"region_id": region, "source": source, "year": year, "rows_in": rows_in,
                            "rows_outside_region": outside, "rows_gridded": gridded,
                            "n_px1km": int(g["n_px1km"].sum()) if len(g) else 0})
            parts.append(g)
        daily = pd.concat(parts, ignore_index=True).sort_values(KEYS, ignore_index=True) if parts else grid_frame(pd.DataFrame(), mask)[0]
        target = Path(out) / "daily" / region / f"{year}.parquet"
        target.parent.mkdir(parents=True, exist_ok=True)
        compact(daily).to_parquet(target, index=False)
        monthly.append(to_monthly(daily))
    m = pd.concat(monthly, ignore_index=True) if monthly else to_monthly(pd.DataFrame())
    (Path(out) / "monthly").mkdir(parents=True, exist_ok=True)
    for sat in config.SATELLITE_FIRST_DAY:  # one file per satellite keeps every file small
        part = m[m["satellite"] == sat].reset_index(drop=True)
        if len(part):
            part = compact(part)
            part["frp_sum"] = part["frp_sum"].astype("float32")
            part.to_parquet(Path(out) / "monthly" / f"{region}__{sat}.parquet", index=False)
    cells = mask.cells()
    cells.insert(0, "region_id", region)
    rin = sum(s["rows_in"] for s in summary)
    rout = sum(s["rows_outside_region"] for s in summary)
    rg = sum(s["rows_gridded"] for s in summary)
    log(f"{region}: {len(years)} years, rows in {rin:,}, outside region {rout:,} ({100 * rout / max(rin, 1):.1f}%), "
        f"gridded {rg:,}, cells {len(cells):,}, monthly rows {len(m):,} [{'OK' if rin == rout + rg and int(m['n'].sum()) == rg else 'CHECK'}]")
    return summary, m, cells


def region_monthly(region, m):
    r = m.groupby(["year", "month", "satellite"], as_index=False).agg(
        sensor=("sensor", "first"), n=("n", "sum"), n_night=("n_night", "sum"), n_px1km=("n_px1km", "sum"),
        frp_sum=("frp_sum", "sum"), cells_active=("n", "size"))
    r["frp_sum"] = r["frp_sum"].round(1)
    r.insert(0, "region_id", region)
    return r


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append", choices=list(config.REGIONS))
    a = p.parse_args(argv)
    regions = a.region or [r for r in config.ACTIVE_REGIONS if (common.FILTERED / r).is_dir()]
    if not regions:
        raise SystemExit(f"No filtered data in {common.FILTERED}. Run steps 02 and 03 first (and check Drive is mounted).")
    t0 = time.time()
    summary, rm, cells = [], [], []
    for region in regions:
        s, m, c = run_region(region)
        summary += s
        rm.append(region_monthly(region, m))
        cells.append(c)

    def merge_csv(path, new, key="region_id"):
        """Keep rows of regions not in this run, replace the others (so --region runs do not drop regions)."""
        path = Path(path)
        if path.exists():
            old = pd.read_csv(path)
            new = pd.concat([old[~old[key].isin(regions)], new], ignore_index=True)
        order = {r: i for i, r in enumerate(config.REGIONS)}
        new = new.sort_values(key, key=lambda s: s.map(order), kind="mergesort", ignore_index=True)
        path.parent.mkdir(parents=True, exist_ok=True)
        new.to_csv(path, index=False)
        return new

    merge_csv(GRID / "region_monthly.csv", pd.concat(rm, ignore_index=True))
    merge_csv(GRID / "region_cells.csv", pd.concat(cells, ignore_index=True))
    merge_csv(common.REPORTS / "grid_summary.csv", pd.DataFrame(summary))
    tot = pd.DataFrame(summary).groupby(["region_id", "source"], sort=False)[["rows_in", "rows_outside_region", "rows_gridded", "n_px1km"]].sum()
    tot["pct_outside"] = (100 * tot["rows_outside_region"] / tot["rows_in"].clip(lower=1)).round(1)
    tot["px1km_per_detection"] = (tot["n_px1km"] / tot["rows_gridded"].clip(lower=1)).round(3)
    print(tot.to_string())
    print(f"Grid written to {GRID} (daily/, monthly/, region_monthly.csv, region_cells.csv); "
          f"report {common.REPORTS}/grid_summary.csv. Took {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
