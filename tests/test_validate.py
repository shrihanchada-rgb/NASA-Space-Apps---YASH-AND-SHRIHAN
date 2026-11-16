"""Tests for pipeline/07_validate.py: the checks must fail when something is wrong (no data, no internet)."""
import importlib.util
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("validate07", ROOT / "pipeline" / "07_validate.py")
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


def good_forecast():
    return {"kind": "experimental_forecast", "origin_date": "2026-08-31", "method_version": "A1-1.0",
            "predictions": [{"date": f"2026-09-0{i}", "q10": 1.0, "median": 2.0, "q90": 3.0} for i in range(1, 8)]}


def test_forecast_check_accepts_a_good_file():
    assert v.check_forecast(good_forecast(), "2026-08-31", "A1-1.0") == []


def test_forecast_check_catches_wrong_start_count_order_and_version():
    f = good_forecast()
    f["predictions"][2]["q10"] = 5.0  # above the median
    f["predictions"].pop()
    f["origin_date"] = "2026-08-30"
    f["method_version"] = "X"
    problems = " | ".join(v.check_forecast(f, "2026-08-31", "A1-1.0"))
    assert "origin_date" in problems and "6 predictions" in problems and "quantiles not ordered" in problems and "method_version" in problems


def test_site_scan_finds_foreign_data_and_addresses(tmp_path):
    web = tmp_path / "web"
    (web / "public" / "latest" / "data").mkdir(parents=True)
    (web / "public" / "map").mkdir(parents=True)
    (web / "src").mkdir()
    (web / "public" / "latest" / "data" / "calendar.json").write_text("{}")
    (web / "public" / "map" / "ca-places.json").write_text("{}")  # our own labels: allowed
    (web / "src" / "a.ts").write_text("fetch('https://yashneil75.github.io/califire/data/calendar.json')")
    (web / "node_modules").mkdir()
    (web / "node_modules" / "x.ts").write_text("yashneil75.github.io")  # ignored
    problems = v.scan_web_for_foreign_data(web)
    assert any("public/latest/data/calendar.json" in p for p in problems)
    assert any("src/a.ts" in p for p in problems)
    assert not any("ca-places" in p or "node_modules" in p for p in problems)


def test_the_real_site_folder_is_clean_and_uses_processed_data():
    assert v.scan_web_for_foreign_data(ROOT / "web") == []
    assert v.vite_default_data_dir((ROOT / "web" / "vite.config.ts").read_text()) == "../data/processed"


def test_rerun_comparison_is_identical_for_the_committed_files_and_catches_a_change(tmp_path):
    s16 = ROOT / "docs" / "validation" / "S16"
    new = tmp_path / "cal"
    (new / "compare").mkdir(parents=True)
    # a "fresh run" that is the committed results restricted to California, as step 05 produces
    shutil.copy(s16 / "metrics.csv", new / "compare" / "metrics.csv")
    shutil.copy(s16 / "choice.json", new / "compare" / "choice.json")
    shutil.copy(s16 / "params.json", new / "params.json")
    assert v.compare_us_ca(new, s16) == []
    rows = (new / "compare" / "metrics.csv").read_text().replace("US-CA,A1,60,0.992", "US-CA,A1,60,0.900")
    (new / "compare" / "metrics.csv").write_text(rows)
    assert any("A1 r2" in d for d in v.compare_us_ca(new, s16))
    c = json.loads((new / "compare" / "choice.json").read_text())
    c["winner"] = "A0"
    (new / "compare" / "choice.json").write_text(json.dumps(c))
    assert any("chosen method" in d for d in v.compare_us_ca(new, s16))
