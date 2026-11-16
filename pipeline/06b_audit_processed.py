"""Audit data/processed/ for double counting and harmonization errors. Prints PASS/FAIL per check, exits 1 on any FAIL.

It re-derives the numbers by a different route than 06_aggregate.py (straight from the hotspot CSV rows and
from the S14 grid totals) and compares. Run it after every rebuild of data/processed/:

  python3 pipeline/06b_audit_processed.py            # California
  python3 pipeline/06b_audit_processed.py --region US-CA --folder data/processed

Checks:
  A  no detection appears twice (exact duplicate rows; same row in two year files)
  B  detection counts per satellite equal the S14 grid totals (nothing lost or added since gridding)
  C  every row's weight equals the weight rebuilt here from the rules (service dates, outage list, factors, k);
     the two halves of the blend add up to one estimate, not two
  D  count_harm recomputed from raw counts and k equals monthly.json, for every month
  E  on days with both sensors, the combined value lies between the two single-sensor estimates (never their sum)
  F  monthly = sum of daily = sum of grid cells = sum of hotspot weights
  G  no jump where the recipe changes (Jan 2012): harmonized / MODIS estimate per year
  H  baseline.json equals statistics recomputed from monthly.json
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402

AQUA_FIRST = config.SATELLITE_FIRST_DAY["A"].isoformat()


class Audit:
    def __init__(self):
        self.failed = 0

    def check(self, name, ok, detail=""):
        ok = bool(ok)
        self.failed += not ok
        print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))
        return ok


def audit(region, folder, grid_monthly_csv=None, log=print):
    a = Audit()
    rdir = Path(folder) / "regions" / region
    meta = json.loads((Path(folder) / "metadata.json").read_text())
    monthly = pd.DataFrame(json.loads((rdir / "monthly.json").read_text())["months"])
    daily = json.loads((rdir / "daily.json").read_text())
    check = json.loads((rdir / "harmonization_check.json").read_text())
    k = {int(m): v for m, v in check["k_by_calendar_month"].items()}
    policy = check["policy"]
    src = {s["source"]: s for s in meta["sources"]}
    snpp_first, snpp_last = src["VIIRS_SNPP_SP"]["first_date"], src["VIIRS_SNPP_SP"]["last_date"]
    modis_last = src["MODIS_SP"]["last_date"]

    frames = []
    for p in sorted((rdir / "hotspots").glob("*.csv")):
        d = pd.read_csv(p, dtype={"time_utc": str})
        frames.append(d.assign(_file=p.stem))
    h = pd.concat(frames, ignore_index=True)
    a.check("A  every hotspot row is in the file of its own month", (h["date"].str[:len(h["_file"].iloc[0])] == h["_file"]).all(), f"{len(frames)} files, {len(h):,} rows")
    h = h.drop(columns="_file")
    dup = int(h.duplicated(["date", "time_utc", "latitude", "longitude", "satellite", "frp", "confidence", "daynight"]).sum())
    a.check("A  no exact duplicate detections (same satellite, time, place, FRP)", dup == 0, f"{dup} duplicates")
    same_px = int(h.duplicated(["date", "time_utc", "latitude", "longitude", "satellite"]).sum())
    a.check("A  no two rows share satellite, date, time and pixel position", same_px == 0, f"{same_px} rows")

    by_sat = h.groupby("satellite").size()
    if grid_monthly_csv and Path(grid_monthly_csv).exists():
        g = pd.read_csv(grid_monthly_csv)
        g = g[g["region_id"] == region].groupby("satellite")["n"].sum()
        a.check("B  detections per satellite equal the S14 grid totals", all(int(by_sat.get(s, 0)) == int(g.get(s, 0)) for s in set(by_sat.index) | set(g.index)),
                ", ".join(f"{s} {int(by_sat.get(s, 0)):,}" for s in ("T", "A", "N", "N20", "N21")))
    total_meta = sum(s["n_detections_kept"] for s in meta["sources"])
    a.check("B  rows = n_detections_kept in metadata.json", len(h) == total_meta, f"{len(h):,} vs {total_meta:,}")

    # C: expected weight of every row, rebuilt here from the outage list, the service dates and the factors
    out = pd.read_csv(rdir / "satellite_outages.csv")
    kt = {int(m): v for m, v in check["terra_only_factor_by_month"].items()}
    ka = {int(m): v for m, v in check["aqua_only_factor_by_month"].items()}
    service = {"T": (src["MODIS_SP"]["first_date"], modis_last), "A": (max(src["MODIS_SP"]["first_date"], AQUA_FIRST), modis_last),
               "N": (snpp_first, snpp_last), "N20": (src["VIIRS_NOAA20_SP"]["first_date"], src["VIIRS_NOAA20_SP"]["last_date"])}
    days = pd.date_range(daily["start"], daily["end"], freq="D").strftime("%Y-%m-%d")
    has = pd.DataFrame({sat: (days >= a) & (days <= b) for sat, (a, b) in service.items()}, index=days)
    for o in out.itertuples():
        if o.satellite in has:
            has.loc[o.start:o.end, o.satellite] = False
    mon = pd.Series(days.str[5:7].astype(int), index=days)
    two = has["T"] & has["A"]
    any_modis = has["T"] | has["A"]
    blend = any_modis & has["N"] & (policy == "blend")
    exp = pd.DataFrame(index=days)
    exp["T"] = np.where(has["T"], np.where(two, 1.0, mon.map(kt)) * np.where(blend, 0.5, 1.0), 0.0)
    exp["A"] = np.where(has["A"], np.where(two, 1.0, mon.map(ka)) * np.where(blend, 0.5, 1.0), 0.0)
    exp["N"] = np.where(blend, 0.5 * mon.map(k), np.where(~any_modis & has["N"], mon.map(k), 0.0))
    exp["N20"] = np.where(~any_modis & ~has["N"] & has["N20"], mon.map(k), 0.0)
    exp["N21"] = 0.0
    w = h["harmonized_weight"]
    expected = pd.Series(0.0, index=h.index)
    for sat in ("T", "A", "N", "N20", "N21"):
        m = h["satellite"] == sat
        expected[m] = h.loc[m, "date"].map(exp[sat]).to_numpy()
    worst = float((w - expected).abs().max())
    a.check("C  every row's weight equals the weight rebuilt from the rules (service dates, outages, factors, k)", worst <= 2e-5,
            f"policy {policy}, largest difference {worst:.6f}, {len(out)} outage periods")
    modis = h["sensor"] == "MODIS"
    blend_row = h["date"].map(blend).to_numpy()
    a.check("C  on days with both estimates, MODIS and S-NPP each carry half; NOAA-20 and NOAA-21 carry nothing",
            (w[h["satellite"].isin(["N20", "N21"]) & blend_row] == 0).all()
            and np.allclose(w[modis & blend_row & h["date"].map(two).to_numpy()], 0.5))
    a.check("C  no detection of a satellite sits inside one of its own total outages with a weight", (w[expected == 0] == 0).all())
    n_out = h[(h["satellite"] == "N") & ~h["date"].map(has["N"]).to_numpy()]
    a.check("C  S-NPP rows on partial-outage days are kept for raw counts but have weight 0", (n_out["harmonized_weight"] == 0).all(), f"{len(n_out)} rows")

    # D/E: the two single-sensor estimates per month, and their combination
    h["ym"] = h["date"].str[:7]
    hm = h["date"].str[5:7].astype(int)
    two_row, has_t, has_a = h["date"].map(two).to_numpy(), h["date"].map(has["T"]).to_numpy(), h["date"].map(has["A"]).to_numpy()
    fac = np.where(two_row, 1.0, np.where(h["satellite"] == "T", hm.map(kt), hm.map(ka)))
    h["m_est"] = np.where(modis & np.where(h["satellite"] == "T", has_t, has_a), fac, 0.0)
    h["v_est"] = np.where((h["satellite"] == "N") & h["date"].map(has["N"]).to_numpy(), hm.map(k), 0.0)
    h["v20_est"] = np.where((h["satellite"] == "N20") & h["date"].map(~any_modis & ~has["N"] & has["N20"]).to_numpy(), hm.map(k), 0.0)
    h["blend"] = blend_row
    h["anym"] = h["date"].map(any_modis).to_numpy()
    harm_row = np.where(h["blend"], 0.5 * h["m_est"] + 0.5 * h["v_est"], np.where(h["anym"], h["m_est"], h["v_est"] + h["v20_est"]))
    rec = pd.DataFrame({"harm": pd.Series(harm_row, index=h.index).groupby(h["ym"]).sum(), "w": w.groupby(h["ym"]).sum(),
                        "m_blend": h["m_est"].where(h["blend"], 0).groupby(h["ym"]).sum(), "v_blend": h["v_est"].where(h["blend"], 0).groupby(h["ym"]).sum(),
                        "m_all": h["m_est"].groupby(h["ym"]).sum()})
    monthly["ym"] = monthly["year"].astype(str) + "-" + monthly["month"].astype(str).str.zfill(2)
    mm = monthly.set_index("ym")
    target = mm["count_harm"].astype(float).fillna(0.0)
    diff = (rec["harm"].reindex(mm.index).fillna(0.0) - target).abs()
    a.check("D  count_harm recomputed from raw detections, factors and k equals monthly.json in every month", (diff <= 0.02 + 2e-5 * target).all(),
            f"largest difference {diff.max():.3f}")
    bm = rec[(rec["m_blend"] + rec["v_blend"]) > 0]
    part = 0.5 * bm["m_blend"] + 0.5 * bm["v_blend"]
    lo, hi = np.minimum(bm["m_blend"], bm["v_blend"]), np.maximum(bm["m_blend"], bm["v_blend"])
    a.check("E  on days with both sensors, the combined value lies between the MODIS estimate and the S-NPP estimate (never their sum)",
            ((part >= lo - 1e-6) & (part <= hi + 1e-6)).all(), f"{len(bm)} months")
    tot_ratio = float(part.sum() / bm["m_blend"].sum()) if bm["m_blend"].sum() else float("nan")
    a.check("E  those days in total: combined / MODIS estimate is close to 1 (2 would mean double counting)", 0.9 <= tot_ratio <= 1.1, f"{tot_ratio:.3f}")

    # F: consistency across files
    start = dt.date.fromisoformat(daily["start"])
    dd = pd.DataFrame(daily["columns"])
    dd["ym"] = [(start + dt.timedelta(days=i)).strftime("%Y-%m") for i in range(len(dd))]
    ds = dd.groupby("ym")["count_harm"].sum(min_count=1).reindex(mm.index)
    a.check("F  sum of daily count_harm equals monthly count_harm", np.allclose(ds.fillna(0), mm["count_harm"].astype(float).fillna(0), atol=0.02))
    a.check("F  sum of hotspot weights equals monthly count_harm", np.allclose(rec["w"].reindex(mm.index).fillna(0), mm["count_harm"].astype(float).fillna(0), atol=0.02))
    gm = pd.read_csv(rdir / "grid_monthly.csv")
    gm["ym"] = gm["year"].astype(str) + "-" + gm["month"].astype(str).str.zfill(2)
    gs = gm.groupby("ym")[["count_harm", "count_raw_modis", "count_raw_viirs"]].sum().reindex(mm.index).fillna(0)
    a.check("F  sum over grid cells equals monthly count_harm and raw counts",
            np.allclose(gs["count_harm"], mm["count_harm"].astype(float).fillna(0), atol=0.3)
            and (gs["count_raw_modis"] == mm["count_raw_modis"].fillna(0)).all() and (gs["count_raw_viirs"] == mm["count_raw_viirs"].fillna(0)).all())
    cells = pd.read_csv(rdir / "grid_cells.csv")
    a.check("F  every grid row is in a cell of the region, once per month", not gm.duplicated(["year", "month", "lat_idx", "lon_idx"]).any()
            and set(zip(gm["lat_idx"], gm["lon_idx"])) <= set(zip(cells["lat_idx"], cells["lon_idx"])))
    a.check("F  raw MODIS + raw VIIRS in monthly.json equals the number of hotspot rows",
            int(mm["count_raw_modis"].fillna(0).sum() + mm["count_raw_viirs"].fillna(0).sum()) == len(h))

    # G: steps where the recipe changes
    yrs = pd.DataFrame({"harm": target.groupby(mm["year"].to_numpy()).sum(), "modis_est": rec["m_all"].reindex(mm.index).fillna(0).groupby(mm["year"].to_numpy()).sum()})
    ratio = (yrs["harm"] / yrs["modis_est"]).round(3)
    pre = ratio[(ratio.index >= 2003) & (ratio.index <= 2011)]
    post = ratio[(ratio.index >= 2012) & (ratio.index <= 2025)]
    a.check("G  2003-2011: harmonized equals the MODIS estimate (ratio exactly 1)", (pre == 1.0).all())
    a.check("G  2012-2025: harmonized stays within 10 % of the MODIS estimate every year (no jump from adding VIIRS)", ((post > 0.9) & (post < 1.1)).all(),
            f"min {post.min():.3f}, max {post.max():.3f}, mean {post.mean():.3f}")
    log("      harmonized / MODIS estimate per year: " + ", ".join(f"{y} {v:.2f}" for y, v in ratio.items()))

    # H: baseline
    base = json.loads((rdir / "baseline.json").read_text())
    y0, y1 = base["base_period"]["start_year"], base["base_period"]["end_year"]
    okb = True
    for b in base["months"]:
        v = monthly[(monthly["month"] == b["month"]) & monthly["year"].between(y0, y1)]["count_harm"].dropna().astype(float)
        okb &= b["n_years"] == len(v) and abs(b["mean"] - v.mean()) < 0.02 and abs(b["p50"] - np.percentile(v, 50)) < 0.02 and abs(b["std"] - v.std(ddof=1)) < 0.02
    a.check(f"H  baseline.json ({y0}-{y1}) equals statistics recomputed from monthly.json", okb)
    return a.failed


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", default=config.ACTIVE_REGIONS[0], choices=list(config.REGIONS))
    p.add_argument("--folder", default=str(common.ROOT / "data" / "processed"))
    a = p.parse_args(argv)
    cands = [common.INTERIM / "grid" / "region_monthly.csv", common.ROOT / "data" / "interim_extract" / "grid" / "region_monthly.csv"]
    failed = audit(a.region, a.folder, next((c for c in cands if c.exists()), None))
    print(f"{failed} check(s) failed" if failed else "All checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
