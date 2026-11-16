"""Tests for the data contract validator, using the sample fixtures (no downloads)."""
import json
import shutil
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from validate_data import validate  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "web" / "fixtures"


def test_fixtures_are_valid():
    assert validate(FIXTURES) == []


def test_fixtures_are_marked_sample():
    for p in FIXTURES.rglob("*.json"):
        assert json.loads(p.read_text())["is_sample"] is True, p


@pytest.fixture
def copy(tmp_path):
    dst = tmp_path / "fx"
    shutil.copytree(FIXTURES, dst)
    return dst


def edit(path, fn):
    doc = json.loads(path.read_text())
    fn(doc)
    path.write_text(json.dumps(doc))


def test_detects_monthly_daily_mismatch(copy):
    edit(copy / "regions/US-CA/monthly.json", lambda d: d["months"][7].update(count_raw_modis=d["months"][7]["count_raw_modis"] + 5))
    assert any("count_raw_modis" in e for e in validate(copy))


def test_detects_missing_month(copy):
    edit(copy / "regions/US-CA/monthly.json", lambda d: d["months"].pop(3))
    assert any("gap or order" in e for e in validate(copy))


def test_detects_zero_instead_of_null_band(copy):
    def f(d):
        m = next(m for m in d["months"] if m["count_harm"] is None)
        m["count_low"] = 0
    edit(copy / "regions/US-CA/monthly.json", f)
    assert validate(copy)


def test_detects_short_daily_column(copy):
    edit(copy / "regions/US-CA/daily.json", lambda d: d["columns"]["frp_sum"].pop())
    assert any("frp_sum" in e for e in validate(copy))


def test_detects_bad_hotspot_value(copy):
    p = copy / "regions/US-CA/hotspots/2023-07.csv"
    lines = p.read_text().splitlines()
    lines[1] = lines[1].replace(",nominal,", ",medium,").replace(",high,", ",medium,")
    p.write_text("\n".join(lines) + "\n")
    assert any("bad value" in e for e in validate(copy))
