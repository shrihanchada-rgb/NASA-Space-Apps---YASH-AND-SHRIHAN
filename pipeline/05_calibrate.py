"""Step 5 (S15): fit the candidate harmonization methods and write their predictions.

Goal: turn VIIRS detections into "MODIS-equivalent" detections (MODIS Terra + Aqua is the reference scale).
The conversion is learned from months where both flew. VIIRS is represented by ONE satellite, S-NPP
(config.VIIRS_REFERENCE_SATELLITE), because the number of VIIRS satellites changes in 2018 and 2023
(docs/validation/S13/README.md).

Input:  data/interim/grid/monthly/<REGION>__<SAT>.parquet (from 04_dedupe_and_grid.py); if that folder
        is missing, the committed copy in data/interim_extract/grid/monthly/ is used.
Output: data/interim/calibration/
  region_month.csv   one row per region and overlap month: MODIS (T, A, M = T + A), S-NPP counts,
                     split (train/test/other), and one prediction column per method
  params.json        the fitted numbers of every method (ratios, power-law coefficients, quantile tables)
  terra_only.csv     second problem: estimating Terra + Aqua from Terra alone (for Nov 2000 - Jun 2002)

Methods (all fitted on TRAIN years only, per region):
  A0  ratio          M = k * V                      one number per region
  A1  ratio/month    M = k[month of year] * V       12 numbers per region (season-dependent)
  A2  power law      per 0.25-degree cell and month: M = c * V^b, then summed over cells (Candidate A)
  B0  1 km + ratio   M = k * V_px1km                VIIRS first collapsed to ~1 km boxes (Candidate B)
  B1  1 km + ratio/month
  C   quantile map   monthly S-NPP total -> same quantile of the monthly MODIS totals (Candidate C)

Example:  python3 pipeline/05_calibrate.py
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402

GRID_MONTHLY = common.INTERIM / "grid" / "monthly"
GRID_FALLBACK = common.ROOT / "data" / "interim_extract" / "grid" / "monthly"
OUT = common.INTERIM / "calibration"
METHODS = ["A0", "A1", "A2", "B0", "B1", "C"]
METHOD_NAMES = {"A0": "ratio", "A1": "ratio per calendar month", "A2": "power law per cell",
                "B0": "1 km collapse + ratio", "B1": "1 km collapse + ratio per calendar month", "C": "quantile mapping"}
# Complete overlap months: S-NPP starts 20 Jan 2012 (January 2012 is partial) and SP data ends 31 Jul 2026.
OVERLAP_FIRST, OVERLAP_LAST = (2012, 2), (2026, 7)
MIN_V_FOR_MONTH_RATIO = 200   # a calendar month needs this many S-NPP train detections for its own ratio
CELL_KEYS = ["year", "month", "lat_idx", "lon_idx"]


def grid_dir():
    return GRID_MONTHLY if GRID_MONTHLY.is_dir() and any(GRID_MONTHLY.glob("*.parquet")) else GRID_FALLBACK


def load_sat(region, sat, folder=None):
    path = Path(folder or grid_dir()) / f"{region}__{sat}.parquet"
    if not path.exists():
        return pd.DataFrame(columns=CELL_KEYS + ["n", "n_px1km"])
    return pd.read_parquet(path, columns=CELL_KEYS + ["n", "n_px1km"])


def cell_table(region, folder=None, vsat=config.VIIRS_REFERENCE_SATELLITE):
    """One row per cell and month with any detection: T, A, M (= T + A), V, Vpx. Missing = 0."""
    parts = {}
    for sat, cols in (("T", {"n": "T"}), ("A", {"n": "A"}), (vsat, {"n": "V", "n_px1km": "Vpx"})):
        d = load_sat(region, sat, folder)
        parts[sat] = d.set_index(CELL_KEYS)[list(cols)].rename(columns=cols)
    t = pd.concat(parts.values(), axis=1).fillna(0).reset_index()
    for c in ("T", "A", "V", "Vpx"):
        t[c] = t[c].astype("int64")
    t["M"] = t["T"] + t["A"]
    return t


def split_of(year, month):
    if not (OVERLAP_FIRST <= (year, month) <= OVERLAP_LAST):
        return "outside"
    if config.TRAIN_YEARS[0] <= year <= config.TRAIN_YEARS[1]:
        return "train"
    if config.TEST_YEARS[0] <= year <= config.TEST_YEARS[1]:
        return "test"
    return "other"


def region_table(cells):
    """Region totals per month, for every month from Nov 2000 to Aug 2026 (months without detections = 0)."""
    r = cells.groupby(["year", "month"])[["T", "A", "M", "V", "Vpx"]].sum()
    idx = pd.MultiIndex.from_tuples([(y, m) for y in range(2000, 2027) for m in range(1, 13)
                                     if (2000, 11) <= (y, m) <= (2026, 8)], names=["year", "month"])
    r = r.reindex(idx, fill_value=0).reset_index()
    r["split"] = [split_of(y, m) for y, m in zip(r["year"], r["month"])]
    return r


def ratio(m, v):
    return float(m.sum() / v.sum()) if v.sum() > 0 else float("nan")


def month_ratios(train, vcol, overall):
    """12 ratios; a calendar month with too little S-NPP data in the train years falls back to the overall ratio."""
    out = {}
    for mo in range(1, 13):
        d = train[train["month"] == mo]
        out[mo] = ratio(d["M"], d[vcol]) if d[vcol].sum() >= MIN_V_FOR_MONTH_RATIO else overall
    return out


def fit_power(cells_train):
    """log M = a + b log V on cell-months with both > 0; c is then scaled so the train total is reproduced."""
    both = cells_train[(cells_train["M"] > 0) & (cells_train["V"] > 0)]
    if len(both) < 30:
        return None
    b, a = np.polyfit(np.log(both["V"]), np.log(both["M"]), 1)
    raw = (cells_train["V"].clip(lower=0) ** b)[cells_train["V"] > 0].sum()
    c = float(cells_train["M"].sum() / raw)   # total-preserving scale (includes MODIS seen where S-NPP saw nothing)
    return {"b": float(b), "c": c, "c_ols": float(np.exp(a)), "n_cell_months": int(len(both))}


def fit_quantile(train):
    """Sorted monthly totals of S-NPP and MODIS in the train years (quantile to quantile)."""
    return {"v": sorted(float(x) for x in train["V"]), "m": sorted(float(x) for x in train["M"])}


def apply_quantile(q, v):
    xs, ys = np.asarray(q["v"]), np.asarray(q["m"])
    v = np.asarray(v, dtype="float64")
    out = np.interp(v, xs, ys)
    top = ys[-1] / xs[-1] if xs[-1] > 0 else 0.0      # beyond the largest train month: keep the top ratio
    out = np.where(v > xs[-1], v * top, out)
    return np.where(v <= 0, 0.0, out)


def fit_region(cells, reg):
    train = reg[reg["split"] == "train"]
    ctrain = cells.merge(train[["year", "month"]], on=["year", "month"])
    p = {"A0": {"k": ratio(train["M"], train["V"])}, "B0": {"k": ratio(train["M"], train["Vpx"])}}
    p["A1"] = {"k": month_ratios(train, "V", p["A0"]["k"])}
    p["B1"] = {"k": month_ratios(train, "Vpx", p["B0"]["k"])}
    p["A2"] = fit_power(ctrain)
    p["C"] = fit_quantile(train)
    return p


def predict(cells, reg, p):
    out = reg.copy()
    out["A0"] = p["A0"]["k"] * out["V"]
    out["B0"] = p["B0"]["k"] * out["Vpx"]
    out["A1"] = out["month"].map(lambda m: p["A1"]["k"][m]) * out["V"]
    out["B1"] = out["month"].map(lambda m: p["B1"]["k"][m]) * out["Vpx"]
    if p["A2"]:
        c = cells[cells["V"] > 0]
        pred = (p["A2"]["c"] * c["V"] ** p["A2"]["b"]).groupby([c["year"], c["month"]]).sum()
        out["A2"] = [float(pred.get((y, m), 0.0)) for y, m in zip(out["year"], out["month"])]
    else:
        out["A2"] = np.nan
    out["C"] = apply_quantile(p["C"], out["V"])
    for m in METHODS:   # no S-NPP data outside the overlap: no prediction
        out.loc[out["split"] == "outside", m] = np.nan
    return out


def terra_only(reg, train=(2003, 2010), test=(2011, 2018)):
    """Estimate M = Terra + Aqua from Terra alone. F0: one factor per region. F1: one per calendar month."""
    d = reg[(reg["year"] >= train[0]) & (reg["year"] <= test[1])].copy()
    tr = d[d["year"] <= train[1]]
    f0 = ratio(tr["M"], tr["T"])
    f1 = {mo: (ratio(g["M"], g["T"]) if g["T"].sum() >= 100 else f0) for mo, g in ((mo, tr[tr["month"] == mo]) for mo in range(1, 13))}
    d["split"] = np.where(d["year"] <= train[1], "train", "test")
    d["F0"] = f0 * d["T"]
    d["F1"] = d["month"].map(f1) * d["T"]
    return d[["year", "month", "split", "T", "A", "M", "F0", "F1"]], {"F0": f0, "F1": f1, "train": train, "test": test}


def run(regions, folder=None, out=OUT, log=print):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    tables, terra, params = [], [], {}
    for region in regions:
        cells = cell_table(region, folder)
        reg = region_table(cells)
        p = fit_region(cells, reg)
        pred = predict(cells, reg, p)
        pred.insert(0, "region_id", region)
        t, tp = terra_only(reg)
        t.insert(0, "region_id", region)
        params[region] = {**p, "terra_only": tp}
        tables.append(pred)
        terra.append(t)
        a2 = p["A2"]
        log(f"{region}: train months {int((reg['split'] == 'train').sum())}, A0 k={p['A0']['k']:.3f} (S-NPP per MODIS {1 / p['A0']['k']:.2f}), "
            f"B0 k={p['B0']['k']:.3f}, A2 " + (f"b={a2['b']:.3f} c={a2['c']:.3f}" if a2 else "not fitted")
            + f", Terra-only factor {tp['F0']:.2f}")
    full = pd.concat(tables, ignore_index=True)
    for m in METHODS:
        full[m] = full[m].round(2)
    full.to_csv(out / "region_month.csv", index=False)
    tt = pd.concat(terra, ignore_index=True)
    tt[["F0", "F1"]] = tt[["F0", "F1"]].round(2)
    tt.to_csv(out / "terra_only.csv", index=False)
    meta = {"train_years": config.TRAIN_YEARS, "test_years": config.TEST_YEARS, "viirs_satellite": config.VIIRS_REFERENCE_SATELLITE,
            "grid_deg": config.GRID_DEG, "methods": METHOD_NAMES, "regions": params}
    (out / "params.json").write_text(json.dumps(meta, indent=1) + "\n")
    return full, tt, meta


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append", choices=list(config.REGIONS))
    a = p.parse_args(argv)
    folder = grid_dir()
    regions = a.region or [r for r in config.REGIONS if (folder / f"{r}__T.parquet").exists()]
    if not regions:
        raise SystemExit(f"No monthly grid files in {GRID_MONTHLY} or {GRID_FALLBACK}. Run step 04 first.")
    print(f"Grid files: {folder}. Train {config.TRAIN_YEARS}, test {config.TEST_YEARS}.")
    run(regions, folder)
    print(f"Wrote {OUT}/region_month.csv, terra_only.csv, params.json")


if __name__ == "__main__":
    main()
