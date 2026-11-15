"""Step S13: sanity checks on the cleaned and filtered data (README Section 13, Step A).

Reads:  data/raw/<SOURCE>/<REGION>/ file names (which days were downloaded)
        data/interim/clean/...     (all detections, for gap checks)
        data/interim/filtered/...  (kept detections, for the counts and plots)
        data/interim/reports/filter_summary.csv (from 03_filter.py)
Writes: data/interim/validation/  (in Colab this is on Drive)
        <REGION>_yearly.png, <REGION>_monthly.png
        yearly_counts.csv, monthly_counts.csv, gaps.csv, checks_summary.md

Checks (Step A): 1 hotspots per year per sensor; 2 seasonal cycle and peak months; 3 gaps:
missing downloads (bugs) vs months with zero detections (often real; flagged as suspicious when the
other sensor saw fires that month); 4 % removed by each filter (flag above 50 %).

Counts here are raw detections per satellite (no harmonization). VIIRS is the sum of the VIIRS
satellites that were flying, so it steps up in 2018 (NOAA-20) and 2023 (NOAA-21) without any change
in fires: the per-satellite lines show this.

Example:  python3 pipeline/03b_sanity_checks.py
"""
import argparse
import csv
import datetime as dt
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import common  # noqa: E402

VALIDATION = common.INTERIM / "validation"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SAT_OF_SOURCE = {"VIIRS_SNPP_SP": ["N"], "VIIRS_NOAA20_SP": ["N20"], "VIIRS_NOAA21_SP": ["N21"], "MODIS_SP": ["T", "A"]}
SAT_LABEL = {"T": "Terra", "A": "Aqua", "N": "S-NPP", "N20": "NOAA-20", "N21": "NOAA-21"}
SUSPICIOUS_OTHER_SENSOR = 100  # zero in one sensor while the other saw at least this many: flag it (VIIRS sees several times more than MODIS, so small numbers are not suspicious)
FULL_YEAR_DAYS = 360           # a satellite-year with fewer covered days is "partial" (open marker)


def load_counts(base, region, columns=("date", "sensor", "satellite")):
    """Detections per (year, month, sensor, satellite) from parquet files under base/<region>/."""
    frames = []
    for path in sorted((Path(base) / region).glob("*/*.parquet")):
        df = pd.read_parquet(path, columns=list(columns))
        if len(df):
            frames.append(df.assign(year=df["date"].str[:4].astype(int), month=df["date"].str[5:7].astype(int))
                          .groupby(["year", "month", "sensor", "satellite"]).size().rename("count").reset_index())
    if not frames:
        return pd.DataFrame(columns=["year", "month", "sensor", "satellite", "count"])
    return pd.concat(frames).groupby(["year", "month", "sensor", "satellite"], as_index=False)["count"].sum()


def covered_days(raw, region, source):
    """Set of days that have a downloaded chunk file (empty files count: FIRMS answered, no fires)."""
    days = set()
    for _, first, last in common.chunk_files(Path(raw) / source / region):
        d = first
        while d <= last:
            days.add(d)
            d += dt.timedelta(days=1)
    return days


def day_ranges(days):
    """Sorted dates -> list of (first, last) runs of consecutive days."""
    out = []
    for d in sorted(days):
        if out and d == out[-1][1] + dt.timedelta(days=1):
            out[-1][1] = d
        else:
            out.append([d, d])
    return [(a, b) for a, b in out]


def satellite_window(sat, source, availability=None):
    first, last = common.source_dates(source, availability)
    first = max(first, config.SATELLITE_FIRST_DAY[sat])
    return first, last


def months_between(first, last):
    """(year, month) for every month fully or partly inside [first, last]."""
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def find_gaps(region, raw, clean_counts, availability=None):
    rows = []
    for source in common.SOURCES:
        folder = Path(raw) / source / region
        if not folder.is_dir():
            continue
        first, last = common.source_dates(source, availability)
        have = covered_days(raw, region, source)
        expected = {first + dt.timedelta(days=i) for i in range((last - first).days + 1)}
        for a, b in day_ranges(expected - have):
            rows.append({"region_id": region, "kind": "missing_download", "source": source, "satellite": "",
                         "start": a.isoformat(), "end": b.isoformat(), "detail": f"{(b - a).days + 1} days without a raw file (bug: re-run step 01)"})
        for sat in SAT_OF_SOURCE[source]:
            s_first, s_last = satellite_window(sat, source, availability)
            c = clean_counts[clean_counts["satellite"] == sat].set_index(["year", "month"])["count"]
            other = "VIIRS" if source == "MODIS_SP" else "MODIS"
            oc = clean_counts[clean_counts["sensor"] == other].groupby(["year", "month"])["count"].sum()
            for y, m in months_between(s_first, s_last):
                if int(c.get((y, m), 0)) == 0:
                    seen = int(oc.get((y, m), 0))
                    suspicious = seen >= SUSPICIOUS_OTHER_SENSOR
                    rows.append({"region_id": region, "kind": "zero_month_suspicious" if suspicious else "zero_month",
                                 "source": source, "satellite": sat, "start": f"{y}-{m:02d}", "end": f"{y}-{m:02d}",
                                 "detail": f"0 detections from {SAT_LABEL[sat]}; {other} saw {seen}"})
    return rows


def coverage_by_year(region, raw, availability=None):
    """Days covered per (satellite, year), limited to the satellite's own dates."""
    out = {}
    for source in common.SOURCES:
        have = covered_days(raw, region, source)
        for sat in SAT_OF_SOURCE[source]:
            first, last = satellite_window(sat, source, availability)
            for d in have:
                if first <= d <= last:
                    out[(sat, d.year)] = out.get((sat, d.year), 0) + 1
    return out


def plot_yearly(region, yearly, coverage, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(10, 5), dpi=120)
    for sensor, color in (("MODIS", "#1f6fb2"), ("VIIRS", "#c2410c")):
        sub = yearly[yearly["sensor"] == sensor]
        tot = sub.groupby("year")["count"].sum()
        sats = [s for s in SAT_LABEL if s in set(sub["satellite"])]
        full = [y for y in tot.index if all(coverage.get((s, y), 0) >= FULL_YEAR_DAYS for s in sats if (s, y) in coverage)]
        ax.plot(tot.index, tot.values, color=color, lw=0.8, alpha=0.4)
        ax.plot(full, tot.loc[full].values, "o-", color=color, lw=2.2, ms=4, label=f"{sensor} total")
        part = [y for y in tot.index if y not in full]
        ax.plot(part, tot.loc[part].values, "o", mfc="white", color=color, ms=5)
        for s, ls in zip(sats, (":", "--", "-.")):
            v = sub[sub["satellite"] == s].groupby("year")["count"].sum()
            ax.plot(v.index, v.values, ls, color=color, lw=1, label=SAT_LABEL[s])
    ax.set_yscale("log")
    ax.set_xlabel("Year")
    ax.set_ylabel("Detections kept (log scale)")
    ax.set_title(f"{region}: hotspots per year by sensor (raw, filtered, download box). Open markers = partial year")
    ax.grid(True, which="both", alpha=0.25)
    ax.legend(fontsize=8, ncol=2)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def plot_monthly(region, monthly_share, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(9, 4.5), dpi=120)
    width = 0.4
    for i, (sensor, color) in enumerate((("MODIS", "#1f6fb2"), ("VIIRS", "#c2410c"))):
        if sensor in monthly_share:
            ax.bar([m + (i - 0.5) * width for m in range(1, 13)], monthly_share[sensor], width, color=color, label=sensor)
    ax.set_xticks(range(1, 13), MONTHS)
    ax.set_ylabel("% of the sensor's detections (all years)")
    ax.set_title(f"{region}: seasonal cycle (filtered detections, all years added together)")
    ax.grid(True, axis="y", alpha=0.25)
    ax.legend()
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def monthly_shares(filtered_counts):
    out = {}
    for sensor, g in filtered_counts.groupby("sensor"):
        by_m = g.groupby("month")["count"].sum().reindex(range(1, 13), fill_value=0)
        total = by_m.sum()
        out[sensor] = [round(100.0 * v / total, 2) if total else 0.0 for v in by_m]
    return out


def read_filter_summary(path):
    if not Path(path).exists():
        return []
    return list(csv.DictReader(Path(path).read_text().splitlines()))


def run(regions, raw=common.RAW, clean=common.CLEAN, filtered=common.FILTERED, reports=common.REPORTS,
        out=VALIDATION, availability=None, log=print):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    yearly_rows, monthly_rows, gap_rows, md = [], [], [], []
    filt = read_filter_summary(Path(reports) / "filter_summary.csv")
    md.append("# S13 sanity checks (generated by pipeline/03b_sanity_checks.py)\n")
    md.append("Counts are raw detections kept after filtering, inside the download box (not yet clipped to the "
              "region boundary), not harmonized. VIIRS = sum of the VIIRS satellites flying that year.\n")
    for region in regions:
        fc = load_counts(filtered, region)
        cc = load_counts(clean, region)
        if fc.empty:
            log(f"{region}: no filtered data, skipped")
            continue
        cov = coverage_by_year(region, raw, availability)
        yearly = fc.groupby(["year", "sensor", "satellite"], as_index=False)["count"].sum()
        for r in yearly.itertuples():
            yearly_rows.append({"region_id": region, "year": r.year, "sensor": r.sensor, "satellite": r.satellite,
                                "count": int(r.count), "days_covered": cov.get((r.satellite, r.year), 0)})
        for r in fc.itertuples():
            monthly_rows.append({"region_id": region, "year": r.year, "month": r.month, "sensor": r.sensor,
                                 "satellite": r.satellite, "count": int(r.count)})
        shares = monthly_shares(fc)
        gaps = find_gaps(region, raw, cc, availability)
        gap_rows += gaps
        plot_yearly(region, yearly, cov, out / f"{region}_yearly.png")
        plot_monthly(region, shares, out / f"{region}_monthly.png")

        md.append(f"\n## {region}\n")
        tot = fc.groupby("sensor")["count"].sum()
        md.append("- Detections kept: " + ", ".join(f"{s} {int(v):,}" for s, v in tot.items()))
        for sensor, sh in shares.items():
            top = sorted(range(12), key=lambda i: -sh[i])[:3]
            md.append(f"- {sensor} peak months: " + ", ".join(f"{MONTHS[i]} {sh[i]:.1f}%" for i in top)
                      + f" (top 3 together {sum(sh[i] for i in top):.1f}%)")
        yt = fc.groupby(["sensor", "year"])["count"].sum()
        for sensor in yt.index.get_level_values(0).unique():
            s = yt.loc[sensor]
            md.append(f"- {sensor} most active years: " + ", ".join(f"{y} ({int(v):,})" for y, v in s.sort_values(ascending=False).head(3).items()))
        kinds = pd.Series([g["kind"] for g in gaps]).value_counts().to_dict() if gaps else {}
        md.append(f"- Missing-download ranges: {kinds.get('missing_download', 0)}; zero-detection satellite-months: "
                  f"{kinds.get('zero_month', 0)} (other sensor also quiet) + {kinds.get('zero_month_suspicious', 0)} suspicious "
                  f"(other sensor saw >= {SUSPICIOUS_OTHER_SENSOR})")
        for g in [g for g in gaps if g["kind"] != "zero_month"][:15]:
            md.append(f"  - {g['kind']} {g['source']} {g['satellite']} {g['start']}..{g['end']}: {g['detail']}")
        for f in [f for f in filt if f["region_id"] == region]:
            flag = " **CHECK: more than half removed**" if float(f["pct_removed"]) > 50 else ""
            md.append(f"- Filter {f['sensor']}: {f['pct_type']}% removed as non-vegetation type, "
                      f"{f['pct_low_confidence']}% as low confidence, {f['pct_removed']}% in total{flag}")
        log("\n".join(md[md.index(f"\n## {region}\n"):]))

    def write(name, rows, fields):
        with (out / name).open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
    write("yearly_counts.csv", yearly_rows, ["region_id", "year", "sensor", "satellite", "count", "days_covered"])
    write("monthly_counts.csv", monthly_rows, ["region_id", "year", "month", "sensor", "satellite", "count"])
    write("gaps.csv", gap_rows, ["region_id", "kind", "source", "satellite", "start", "end", "detail"])
    (out / "checks_summary.md").write_text("\n".join(md) + "\n")
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append", choices=list(config.REGIONS))
    p.add_argument("--out", default=str(VALIDATION))
    a = p.parse_args(argv)
    regions = a.region or [r for r in config.ACTIVE_REGIONS if (common.FILTERED / r).is_dir()]
    if not regions:
        raise SystemExit(f"No filtered data in {common.FILTERED}. Run steps 02 and 03 first.")
    t0 = time.time()
    out = run(regions, out=a.out)
    print(f"\nWrote plots and tables to {out} (checks_summary.md, gaps.csv, yearly_counts.csv, "
          f"monthly_counts.csv, <REGION>_yearly.png, <REGION>_monthly.png). Took {time.time() - t0:.0f} s.")


if __name__ == "__main__":
    main()
