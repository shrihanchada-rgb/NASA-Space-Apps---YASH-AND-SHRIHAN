"""Step S18: one command that re-creates the validation results and checks the website's data.

    python3 pipeline/07_validate.py            # everything
    python3 pipeline/07_validate.py --skip-fit # only the checks (do not re-run steps 05 and 05b)

What it does, in order:
  1. Re-runs step 05 (fit the harmonization methods) and 05b (score them on the test years, choose one,
     draw the plots) into data/interim/calibration/ (plots: data/interim/calibration/compare/) and checks
     that California's results equal the committed ones in docs/validation/S16/. It never overwrites S16:
     that folder also holds the three archived regions, which a fresh run (California only) does not refit.
  2. Checks that data/processed/ agrees with those results: the scores in metadata.json are the chosen
     method's test scores; the factors in harmonization_check.json are the ones fitted in step 05.
  3. Runs scripts/validate_data.py (the data contract) and pipeline/06b_audit_processed.py
     (double counting and the harmonization arithmetic) on data/processed/.
  4. Checks the forecast file (contract section 8c): seven consecutive days after the last day of the data,
     ordered quantiles, and the same method version.
  5. Checks that the website uses only our data: its data folder is data/processed/, and no data file or
     address from another project is in web/.
  6. Writes docs/validation/S18/README.md with every check and its result.

Exit code 0 = every check passed, 1 = something failed. Needs no internet and no key.
"""
import argparse
import csv
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
CAL = ROOT / "data" / "interim" / "calibration"
S16 = ROOT / "docs" / "validation" / "S16"
S18 = ROOT / "docs" / "validation" / "S18"
WEB = ROOT / "web"


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, ok, detail=""):
        self.rows.append((name, bool(ok), detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
        return ok

    @property
    def failed(self):
        return [r for r in self.rows if not r[1]]


def run(cmd):
    p = subprocess.run([sys.executable, *cmd], cwd=ROOT, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------- pure checks (tested in tests/test_validate.py) ----------

def check_forecast(fc, daily_end, method_version):
    """Problems found in a forecast.json, as a list of text (empty = fine)."""
    out = []
    if fc.get("kind") != "experimental_forecast":
        out.append("kind is not experimental_forecast")
    if fc.get("origin_date") != daily_end:
        out.append(f"origin_date {fc.get('origin_date')} is not the last day of the data {daily_end}")
    if fc.get("method_version") != method_version:
        out.append(f"method_version {fc.get('method_version')} differs from the data's {method_version}")
    preds = fc.get("predictions") or []
    if len(preds) != 7:
        out.append(f"{len(preds)} predictions, expected 7")
    end = dt.date.fromisoformat(daily_end)
    for i, p in enumerate(preds):
        if p.get("date") != (end + dt.timedelta(days=i + 1)).isoformat():
            out.append(f"prediction {i + 1} is dated {p.get('date')}, expected the day {i + 1} after the data")
        if not (0 <= p["q10"] <= p["median"] <= p["q90"]):
            out.append(f"{p.get('date')}: quantiles not ordered")
    return out


def scan_web_for_foreign_data(web):
    """Files or addresses in web/ that would bring in another project's data. Returns a list of problems."""
    problems = []
    skip = {"node_modules", "dist"}
    own_json = {"ca-places.json"}  # the place-name labels: Natural Earth, our own file
    for p in web.rglob("*"):
        if not p.is_file() or skip & set(p.relative_to(web).parts):
            continue
        rel = p.relative_to(web).as_posix()
        if p.suffix in {".json", ".csv", ".geojson"} and rel.startswith("public/") and p.name not in own_json:
            problems.append(f"data file in the site's public folder: {rel}")
        if p.suffix in {".ts", ".html", ".js", ".css"} and re.search(r"yashneil75\.github\.io|califire/data|docs/data/calendar\.json", p.read_text(encoding="utf-8", errors="ignore")):
            problems.append(f"address of another project's data in {rel}")
    return problems


def vite_default_data_dir(vite_text):
    m = re.search(r"process\.env\.DATA_DIR\s*\?\?\s*'([^']+)'", vite_text)
    return m.group(1) if m else None


# ---------- the steps ----------

def compare_us_ca(new_dir, committed_dir):
    """Differences between a fresh run of steps 05/05b and the committed S16 results, for California only.

    The committed S16 folder also holds the three archived regions (evidence for the method); a fresh run
    fits California only, so the two are compared for US-CA and the committed folder is never overwritten.
    """
    diffs = []
    new_m = {r["method"]: r for r in read_csv(Path(new_dir) / "compare" / "metrics.csv") if r["region_id"] == "US-CA"}
    old_m = {r["method"]: r for r in read_csv(Path(committed_dir) / "metrics.csv") if r["region_id"] == "US-CA"}
    if set(new_m) != set(old_m):
        diffs.append(f"methods differ: {sorted(set(new_m) ^ set(old_m))}")
    for m in sorted(set(new_m) & set(old_m)):
        for col in ("n_months", "r2", "r2_log", "mape", "bias"):
            if abs(float(new_m[m][col]) - float(old_m[m][col])) > 1e-6:
                diffs.append(f"{m} {col}: {old_m[m][col]} -> {new_m[m][col]}")
    new_c = json.loads((Path(new_dir) / "compare" / "choice.json").read_text(encoding="utf-8"))
    old_c = json.loads((Path(committed_dir) / "choice.json").read_text(encoding="utf-8"))
    if new_c["winner"] != old_c["winner"]:
        diffs.append(f"chosen method {old_c['winner']} -> {new_c['winner']}")
    if new_c["band_by_region"]["US-CA"] != old_c["band_by_region"]["US-CA"]:
        diffs.append(f"band {old_c['band_by_region']['US-CA']} -> {new_c['band_by_region']['US-CA']}")
    new_p = json.loads((Path(new_dir) / "params.json").read_text(encoding="utf-8"))["regions"]["US-CA"]
    old_p = json.loads((Path(committed_dir) / "params.json").read_text(encoding="utf-8"))["regions"]["US-CA"]
    if json.dumps(new_p, sort_keys=True) != json.dumps(old_p, sort_keys=True):
        diffs.append("fitted parameters (params.json, US-CA) differ")
    return diffs


def step_fit(rep):
    for script in ("pipeline/05_calibrate.py", "pipeline/05b_compare_methods.py"):
        code, out = run([script])
        rep.check(f"re-run {script}", code == 0, out.splitlines()[-1][:110] if out else "")
        if code:
            return False
    diffs = compare_us_ca(CAL, S16)
    rep.check("the re-run gives the committed S16 results for California (all methods, choice, band, parameters)", not diffs, "; ".join(diffs[:3]) or "identical")
    return True


def step_processed_matches(rep):
    meta = json.loads((PROCESSED / "metadata.json").read_text(encoding="utf-8"))
    choice = json.loads((S16 / "choice.json").read_text(encoding="utf-8"))
    rows = [r for r in read_csv(S16 / "metrics.csv") if r["region_id"] == "US-CA" and r["method"] == choice["winner"]]
    rep.check("S16 chose a method for US-CA", len(rows) == 1, f"method {choice['winner']}")
    if len(rows) == 1:
        r2, mape = float(rows[0]["r2"]), float(rows[0]["mape"])
        v = meta["validation"]
        rep.check("scores in metadata.json are the chosen method's test scores",
                  abs(v["r2"] - r2) < 0.0005 and abs(v["median_abs_pct_error"] - mape) < 0.05,
                  f"site: R2 {v['r2']}, error {v['median_abs_pct_error']}%; S16: R2 {r2:.3f}, error {mape:.1f}%")
    params = json.loads((S16 / "params.json").read_text(encoding="utf-8"))["regions"]["US-CA"]
    hc = json.loads((PROCESSED / "regions" / "US-CA" / "harmonization_check.json").read_text(encoding="utf-8"))
    k_fit = params[choice["winner"]]["k"]
    diff = max(abs(float(hc["k_by_calendar_month"][str(m)]) - float(k_fit[str(m)] if isinstance(k_fit, dict) else k_fit)) for m in range(1, 13))
    rep.check("k per calendar month in the data equals the one fitted in step 05", diff < 1e-9, f"largest difference {diff:.2e}")
    band = choice["band_by_region"]["US-CA"]
    got = [round(x, 3) for x in hc["range_factors"]]
    rep.check("uncertainty band in the data equals S16's band", got == [round(band["low_factor"], 3), round(band["high_factor"], 3)], f"{got} vs {band['low_factor']}..{band['high_factor']}")
    rep.check("method_version agrees in metadata and region files",
              meta["method_version"] == hc["method_version"], meta["method_version"])
    rep.check("data is real, not sample", meta["is_sample"] is False and hc["is_sample"] is False)
    return params


def step_data_checks(rep):
    code, out = run(["scripts/validate_data.py", "data/processed"])
    rep.check("data contract: scripts/validate_data.py data/processed", code == 0, out.splitlines()[-1] if out else "")
    code, out = run(["pipeline/06b_audit_processed.py"])
    rep.check("audit: no double counting, harmonization arithmetic right", code == 0, out.splitlines()[-1] if out else "")


def step_forecast(rep):
    path = PROCESSED / "regions" / "US-CA" / "forecast.json"
    if not path.exists():
        rep.check("forecast.json exists (made by the Forecast GitHub Actions job)", False, "missing")
        return
    fc = json.loads(path.read_text(encoding="utf-8"))
    daily = json.loads((PROCESSED / "regions" / "US-CA" / "daily.json").read_text(encoding="utf-8"))
    problems = check_forecast(fc, daily["end"], daily["method_version"])
    rep.check("forecast: 7 days after the data ends, quantiles ordered, same method version", not problems, "; ".join(problems) or f"{fc['predictions'][0]['date']} to {fc['predictions'][-1]['date']}")


def step_site_uses_our_data(rep):
    vite = (WEB / "vite.config.ts").read_text(encoding="utf-8")
    rep.check("the site's default data folder is data/processed", vite_default_data_dir(vite) == "../data/processed", str(vite_default_data_dir(vite)))
    problems = scan_web_for_foreign_data(WEB)
    rep.check("no other project's data file or address in web/", not problems, "; ".join(problems[:3]))


def write_report(rep, fit_ran):
    S18.mkdir(parents=True, exist_ok=True)
    lines = ["# S18: validation re-run and data checks", "",
             f"Made by `python3 pipeline/07_validate.py{'' if fit_ran else ' --skip-fit'}` on {dt.date.today().isoformat()}. "
             "Result: **" + ("all checks passed" if not rep.failed else f"{len(rep.failed)} check(s) FAILED") + "**.", "",
             "| Check | Result | Detail |", "|---|---|---|"]
    for name, ok, detail in rep.rows:
        lines.append(f"| {name} | {'pass' if ok else '**FAIL**'} | {detail.replace('|', '/')} |")
    lines += ["", "The scores and plots themselves are in `docs/validation/S16/` (metrics table: `metrics.csv`; plots: `<REGION>_compare.png`); "
              "the summary is `docs/validation/README.md`.", ""]
    (S18 / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--skip-fit", action="store_true", help="do not re-run steps 05 and 05b")
    a = p.parse_args(argv)
    rep = Report()
    fit_ran = not a.skip_fit
    if fit_ran and not step_fit(rep):
        write_report(rep, fit_ran)
        return 1
    step_processed_matches(rep)
    step_data_checks(rep)
    step_forecast(rep)
    step_site_uses_our_data(rep)
    write_report(rep, fit_ran)
    print(f"\n{len(rep.rows) - len(rep.failed)}/{len(rep.rows)} checks passed. Report: {S18 / 'README.md'}")
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
