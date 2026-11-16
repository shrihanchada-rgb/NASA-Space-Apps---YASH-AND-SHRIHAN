"""Tests for pipeline/07_forecast.py with a fake model (no download, no torch)."""
import importlib.util
import json
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("forecast07", ROOT / "pipeline" / "07_forecast.py")
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)


class FakeOutput:
    def __init__(self, n, level):
        self.level = level
        self.median = np.full(n, math.log1p(level))

    def quantile(self, q):
        return np.full(len(self.median), math.log1p(self.level * {0.1: 0.5, 0.5: 1.0, 0.9: 2.0}[q]))


class FakeModel:
    """Predicts the last observed value; records what it was given."""

    def __init__(self):
        self.contexts = []

    def forecast(self, context, prediction_length):
        self.contexts.append(context)
        valid = context[np.isfinite(context)]
        return FakeOutput(prediction_length, float(np.expm1(valid[-1])))


def make_daily(n_days=900, end="2026-08-31", nulls=()):
    end_d = date.fromisoformat(end)
    start = end_d - timedelta(days=n_days - 1)
    values = [float(i % 10) for i in range(n_days)]
    for k in nulls:
        values[k] = None
    return {"schema_version": "1.0", "method_version": "A1-1.0", "is_sample": False, "region_id": "US-CA",
            "start": start.isoformat(), "end": end, "columns": {"count_harm": values}}


def test_missing_days_stay_missing_not_zero():
    daily = make_daily(nulls=(n := 900 - 3,))
    days = fc.daily_series(daily)
    gap = date(2026, 8, 31) - timedelta(days=2)
    assert gap not in days
    ctx = fc.context_for(days, date(2026, 8, 31))
    assert len(ctx) == fc.CONTEXT_DAYS and math.isnan(ctx[-3]) and not math.isnan(ctx[-1])


def test_forecast_starts_the_day_after_the_data_and_uses_nothing_later():
    model = FakeModel()
    out = fc.build(make_daily(), model)
    dates = [p["date"] for p in out["predictions"]]
    assert dates == [(date(2026, 9, 1) + timedelta(days=i)).isoformat() for i in range(7)]
    assert out["origin_date"] == "2026-08-31"
    assert all(p["q10"] <= p["median"] <= p["q90"] for p in out["predictions"])
    assert len(model.contexts[-1]) == fc.CONTEXT_DAYS
    json.dumps(out, allow_nan=False)  # file must be valid JSON


def test_backtest_reports_his_measures():
    rep = fc.backtest(fc.daily_series(make_daily(n_days=4000, end="2026-08-31")), FakeModel())
    assert set(rep["by_year"]) == {"2023", "2024", "2025"}
    assert {"timestral", "seasonal", "persistence", "interval_10_90_coverage"} <= set(rep["pooled"])
    assert rep["pooled"]["timestral"]["n"] > 0


def test_too_little_data_is_refused():
    with pytest.raises(ValueError):
        fc.build(make_daily(n_days=20), FakeModel())
