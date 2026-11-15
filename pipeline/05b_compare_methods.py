"""Step S16: compare the harmonization methods on the test years and choose one (README Section 13, Steps B-D).

Input:  data/interim/calibration/region_month.csv, terra_only.csv, params.json (from 05_calibrate.py)
        data/interim/grid/region_monthly.csv (or data/interim_extract/grid/region_monthly.csv)
Output: data/interim/calibration/compare/  (copied into docs/validation/S16/)
  metrics.csv              one row per region and method: test-year scores
  choice.json              the chosen method, its uncertainty band per region, and how it was chosen
  terra_only_metrics.csv   scores for estimating Terra + Aqua from Terra alone
  viirs_satellite_ratios.csv  NOAA-20 / S-NPP and NOAA-21 / S-NPP per region and year
  <REGION>_compare.png     4 panels: MODIS vs S-NPP, their ratio over time, test-year series, predicted vs real

Scores (test years only; the methods never saw them):
  r2        1 - sum((real - pred)^2) / sum((real - mean real)^2) on monthly counts (1 is perfect)
  r2_log    the same on log(1 + count), so small months matter too
  mape      median of |pred - real| / real in %, months with real >= 10 only
  bias      sum(pred) / sum(real) (1.0 = no bias)

Choice rule: the method with the lowest mape in the most regions; ties go to the simpler method
(order of simplicity: A0, B0, A1, B1, C, A2).

Example:  python3 pipeline/05b_compare_methods.py
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

CAL = common.INTERIM / "calibration"
OUT = CAL / "compare"
METHODS = ["A0", "A1", "A2", "B0", "B1", "C"]
SIMPLICITY = ["A0", "B0", "A1", "B1", "C", "A2"]
MIN_REAL = 10
BAND = (0.10, 0.90)   # the band holds the middle 80 % of train-year errors


def scores(real, pred, min_real=MIN_REAL):
    real, pred = np.asarray(real, dtype="float64"), np.asarray(pred, dtype="float64")
    ok = ~np.isnan(pred)
    real, pred = real[ok], pred[ok]
    if len(real) < 3 or real.sum() == 0:
        return {"n_months": int(len(real)), "r2": None, "r2_log": None, "mape": None, "bias": None}
    def r2(a, b):
        sst = ((a - a.mean()) ** 2).sum()
        return float(1 - ((a - b) ** 2).sum() / sst) if sst > 0 else None
    big = real >= min_real
    return {"n_months": int(len(real)), "r2": round(r2(real, pred), 3), "r2_log": round(r2(np.log1p(real), np.log1p(pred)), 3),
            "mape": round(float(np.median(np.abs(pred[big] - real[big]) / real[big]) * 100), 1) if big.any() else None,
            "bias": round(float(pred.sum() / real.sum()), 3)}


def metrics_table(d, methods=METHODS, real="M", split="test"):
    rows = []
    for region, g in d[d["split"] == split].groupby("region_id", sort=False):
        for m in methods:
            rows.append({"region_id": region, "method": m, **scores(g[real], g[m])})
    return pd.DataFrame(rows)


def choose(metrics):
    """Lowest mape in the most regions; ties (within 0.05 points, or equal wins) go to the simpler method."""
    wins = {m: 0 for m in SIMPLICITY}
    best_by_region = {}
    for region, g in metrics.dropna(subset=["mape"]).groupby("region_id", sort=False):
        lo = g["mape"].min()
        tied = [m for m in SIMPLICITY if m in set(g[g["mape"] <= lo + 0.05]["method"])]
        best_by_region[region] = tied[0]
        wins[tied[0]] += 1
    top = max(wins.values())
    winner = [m for m in SIMPLICITY if wins[m] == top][0]
    return winner, wins, best_by_region


RATIO_METHODS = {"A0": ("V", False), "A1": ("V", True), "B0": ("Vpx", False), "B1": ("Vpx", True)}
MIN_V_FOR_MONTH_RATIO = 200   # same rule as 05_calibrate.py


def leave_one_year_out(train, method):
    """For ratio methods: predict each train year from the other train years (honest, out-of-sample errors)."""
    vcol, by_month = RATIO_METHODS[method]
    pred = pd.Series(np.nan, index=train.index)
    for year in sorted(train["year"].unique()):
        rest, held = train[train["year"] != year], train[train["year"] == year]
        k0 = rest["M"].sum() / rest[vcol].sum() if rest[vcol].sum() > 0 else np.nan
        if by_month:
            ks = {}
            for mo in range(1, 13):
                g = rest[rest["month"] == mo]
                ks[mo] = g["M"].sum() / g[vcol].sum() if g[vcol].sum() >= MIN_V_FOR_MONTH_RATIO else k0
            pred[held.index] = held["month"].map(ks) * held[vcol]
        else:
            pred[held.index] = k0 * held[vcol]
    return pred


def band(d, method, q=BAND):
    """Per region: multipliers so that pred * low .. pred * high should hold the middle 80 % of months.

    Taken from TRAIN years only. For ratio methods the errors are out-of-sample (each train year predicted
    from the other train years), because in-sample errors are too small. test_coverage then reports how
    many test months really fall inside (it is a check, not used to set the band).
    """
    out = {}
    for region, g in d.groupby("region_id", sort=False):
        tr = g[g["split"] == "train"]
        pred = leave_one_year_out(tr, method) if method in RATIO_METHODS else tr[method]
        ok = (tr["M"] >= MIN_REAL) & (pred > 0)
        ratio = (tr["M"][ok] / pred[ok]).to_numpy()
        lo, hi = (float(np.quantile(ratio, q[0])), float(np.quantile(ratio, q[1]))) if len(ratio) >= 10 else (None, None)
        te = g[(g["split"] == "test") & (g["M"] >= MIN_REAL) & (g[method] > 0)]
        cover = float(((te["M"] >= lo * te[method]) & (te["M"] <= hi * te[method])).mean()) if lo and len(te) else None
        out[region] = {"low_factor": round(lo, 3) if lo else None, "high_factor": round(hi, 3) if hi else None,
                       "train_months": int(len(ratio)), "test_coverage": round(cover, 3) if cover is not None else None,
                       "errors": "leave-one-year-out" if method in RATIO_METHODS else "in-sample"}
    return out


def satellite_ratios(path):
    rm = pd.read_csv(path)
    y = rm.pivot_table(index=["region_id", "year", "month"], columns="satellite", values="n", aggfunc="sum").fillna(0)
    rows = []
    for sat, first in (("N20", (2018, 4)), ("N21", (2023, 3))):
        for (region, year), g in y.groupby(level=[0, 1], sort=False):
            g = g[[(yy, mm) >= first and (yy, mm) <= (2026, 7) for _, yy, mm in g.index]]
            if len(g) and g["N"].sum() > 0 and sat in g:
                rows.append({"region_id": region, "year": year, "satellite": sat, "months": len(g),
                             "n_sat": int(g[sat].sum()), "n_snpp": int(g["N"].sum()), "ratio_to_snpp": round(float(g[sat].sum() / g["N"].sum()), 3)})
    return pd.DataFrame(rows)


def plot_region(region, g, winner, bnd, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    ov = g[g["split"].isin(["train", "test", "other"])]
    fig, ax = plt.subplots(2, 2, figsize=(13, 9), dpi=110)
    colors = {"train": "#1f6fb2", "test": "#c2410c", "other": "#8a8a8a"}
    a = ax[0, 0]
    for s, c in colors.items():
        d = ov[ov["split"] == s]
        a.scatter(d["V"].clip(lower=0.5), d["M"].clip(lower=0.5), s=14, color=c, label=f"{s} months", alpha=0.8)
    a.set_xscale("log"); a.set_yscale("log")
    a.set_xlabel("S-NPP VIIRS detections per month"); a.set_ylabel("MODIS (Terra + Aqua) detections per month")
    a.set_title(f"{region}: MODIS vs S-NPP, monthly (log scales)"); a.legend(fontsize=8); a.grid(True, which="both", alpha=0.2)

    a = ax[0, 1]
    d = ov[(ov["M"] >= MIN_REAL) & (ov["V"] > 0)]
    t = d["year"] + (d["month"] - 0.5) / 12
    a.scatter(t, d["V"] / d["M"], s=12, c=d["month"], cmap="twilight")
    a.set_yscale("log"); a.set_xlabel("Year (colour = calendar month)"); a.set_ylabel("S-NPP / MODIS")
    a.set_title("Ratio S-NPP / MODIS per month (months with MODIS >= 10)"); a.grid(True, which="both", alpha=0.2)

    a = ax[1, 0]
    te = g[g["split"] == "test"]
    t = te["year"] + (te["month"] - 0.5) / 12
    a.plot(t, te["M"].clip(lower=0.5), "-", color="#111111", lw=1.6, label="MODIS (real)")
    a.plot(t, te[winner].clip(lower=0.5), "-", color="#c2410c", lw=1.3, label=f"from S-NPP, method {winner}")
    if bnd.get("low_factor"):
        a.fill_between(t, (te[winner] * bnd["low_factor"]).clip(lower=0.5), (te[winner] * bnd["high_factor"]).clip(lower=0.5),
                       color="#c2410c", alpha=0.18, lw=0, label="80 % band (from train years)")
    a.set_yscale("log"); a.set_xlabel("Test years"); a.set_ylabel("Detections per month")
    a.set_title("Test years: real MODIS vs MODIS-equivalent from S-NPP"); a.legend(fontsize=8); a.grid(True, which="both", alpha=0.2)

    a = ax[1, 1]
    lim = [0.5, max(te["M"].max(), te[winner].max()) * 1.5]
    a.plot(lim, lim, "-", color="#888888", lw=1)
    a.scatter(te["M"].clip(lower=0.5), te[winner].clip(lower=0.5), s=16, color="#c2410c")
    a.set_xscale("log"); a.set_yscale("log"); a.set_xlim(lim); a.set_ylim(lim)
    a.set_xlabel("Real MODIS per month"); a.set_ylabel(f"Predicted (method {winner})")
    a.set_title("Test years: predicted vs real (line = perfect)"); a.grid(True, which="both", alpha=0.2)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


def run(cal=CAL, out=OUT, region_monthly=None, plots=True, log=print):
    cal, out = Path(cal), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    d = pd.read_csv(cal / "region_month.csv")
    metrics = metrics_table(d)
    winner, wins, best = choose(metrics)
    bnd = band(d, winner)
    metrics.to_csv(out / "metrics.csv", index=False)
    terra = pd.read_csv(cal / "terra_only.csv")
    tm = metrics_table(terra, methods=["F0", "F1"])
    tm.to_csv(out / "terra_only_metrics.csv", index=False)
    if region_monthly is None:
        cands = [common.INTERIM / "grid" / "region_monthly.csv", common.ROOT / "data" / "interim_extract" / "grid" / "region_monthly.csv"]
        region_monthly = next((p for p in cands if p.exists()), None)
    sat = satellite_ratios(region_monthly) if region_monthly else pd.DataFrame()
    if len(sat):
        sat.to_csv(out / "viirs_satellite_ratios.csv", index=False)
    choice = {"winner": winner, "method_version": f"{winner}-1.0", "wins_lowest_mape": wins, "best_method_by_region": best,
              "band_quantiles": BAND, "band_by_region": bnd, "train_years": config.TRAIN_YEARS, "test_years": config.TEST_YEARS,
              "rule": "lowest test-year mape in the most regions; ties to the simpler method"}
    (out / "choice.json").write_text(json.dumps(choice, indent=1) + "\n")
    if plots:
        for region, g in d.groupby("region_id", sort=False):
            plot_region(region, g, winner, bnd[region], out / f"{region}_compare.png")
    log("Test-year scores (r2 / r2_log / mape % / bias):")
    for region, g in metrics.groupby("region_id", sort=False):
        log(f"  {region}: " + "   ".join(f"{r.method} {r.r2}/{r.r2_log}/{r.mape}/{r.bias}" for r in g.itertuples()))
    log(f"Chosen: {winner} (lowest mape in {wins[winner]} of {len(best)} regions; best per region: {best})")
    log("Band (multiply the prediction by low..high) and share of test months inside it: "
        + "; ".join(f"{r} x{b['low_factor']}..x{b['high_factor']} cover {b['test_coverage']}" for r, b in bnd.items()))
    log("Terra-only -> Terra+Aqua (test 2011-2018) r2/r2_log/mape/bias: "
        + "; ".join(f"{r.region_id} {r.method} {r.r2}/{r.r2_log}/{r.mape}/{r.bias}" for r in tm.itertuples()))
    return metrics, choice, tm, sat


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--no-plots", action="store_true")
    a = p.parse_args(argv)
    if not (CAL / "region_month.csv").exists():
        raise SystemExit(f"No {CAL}/region_month.csv. Run step 05 first.")
    run(plots=not a.no_plots)
    print(f"Wrote {OUT} (metrics.csv, choice.json, terra_only_metrics.csv, viirs_satellite_ratios.csv, <REGION>_compare.png)")


if __name__ == "__main__":
    main()
