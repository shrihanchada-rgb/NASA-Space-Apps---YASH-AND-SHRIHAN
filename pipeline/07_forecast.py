"""Experimental 7-day forecast of the harmonized daily count, with Yashneil's Timestral-5M method.

Adapted from yashneil75/califire (pipeline/forecast_experimental.py and pipeline/evaluate_forecast.py,
MIT licence, copyright Yashneil Gajjala and Shrihan Chada). The algorithm is his, unchanged: Mistral's
Timestral-5M model, log1p-transformed daily values, 730 days of context, missing days passed as missing,
median and 10th/90th percentiles, and his retrospective check against a seasonal median and persistence
(forecasts started on the 1st and 15th of each month in 2023-2025).

What changed, because the input is our data:
- Input: our harmonized daily count (MODIS-equivalent hotspots) for the whole region, from
  data/processed/regions/<id>/daily.json. Days with no satellite data (null) are missing, never zero.
- Start of the forecast: the last day of our data (the standard archive ends there), not "today".
  His script refuses data more than three days old; ours forecasts the 7 days after the archive ends
  and says so in the output, because a forecast "from today" cannot be made from this data.

This is a forecast of satellite-detected activity, not of fire risk. Run in GitHub Actions
(.github/workflows/forecast.yml): the model weights come from Hugging Face. Tests use a fake model.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL_ID = "mistralai/Timestral-5M"
MODEL_REVISION = "bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f"  # the revision his site uses
CONTEXT_DAYS = 730
HORIZON = 7
BACKTEST_YEARS = (2023, 2024, 2025)


# ---------- input ----------

def daily_series(daily: dict) -> dict[date, float]:
    """{day: harmonized count} for days with data. Null days (no satellite data) are left out."""
    start = date.fromisoformat(daily["start"])
    return {start + timedelta(days=i): float(v)
            for i, v in enumerate(daily["columns"]["count_harm"]) if v is not None}


# ---------- his method (unchanged) ----------

def context_for(days, origin, length=CONTEXT_DAYS):
    return np.array([math.log1p(days[d]) if d in days else np.nan
                     for d in (origin - timedelta(days=offset) for offset in range(length - 1, -1, -1))], dtype=np.float32)


def seasonal_baseline(days, origin, horizon):
    """Median of reported days near the target date, from prior years only."""
    values = []
    for n in range(1, horizon + 1):
        target = origin + timedelta(days=n)
        pool = []
        for y in range(origin.year - 5, origin.year):
            for shift in range(-15, 16):
                try:
                    day = date(y, target.month, target.day) + timedelta(days=shift)
                except ValueError:
                    day = date(y, 2, 28) + timedelta(days=shift)
                if day in days and day <= origin:
                    pool.append(days[day])
        values.append(float(np.median(pool)) if pool else float('nan'))
    return np.asarray(values)


def metrics(y, prediction):
    mask = np.isfinite(y) & np.isfinite(prediction)
    y, prediction = y[mask], prediction[mask]
    if not len(y):
        return {"n": 0}
    return {"n": int(len(y)), "mae": float(np.mean(np.abs(prediction - y))),
            "rmse": float(np.sqrt(np.mean((prediction - y) ** 2))),
            "bias": float((prediction.sum() - y.sum()) / y.sum()) if y.sum() else None}


def _quantiles(output, horizon):
    median = np.maximum(0, np.expm1(np.asarray(output.median).reshape(-1)[:horizon]))
    lo = np.maximum(0, np.expm1(np.asarray(output.quantile(.1)).reshape(-1)[:horizon]))
    hi = np.maximum(0, np.expm1(np.asarray(output.quantile(.9)).reshape(-1)[:horizon]))
    return median, lo, hi


def backtest(days, model):
    """His retrospective check: 7-day forecasts from the 1st and 15th of each month, scored on reported days."""
    observed, timestral, seasonal, persistence, low, high = [], [], [], [], [], []
    yearly = {}
    for year in BACKTEST_YEARS:
        yd = {k: [] for k in ('actual', 'median', 'seasonal', 'persistence', 'low', 'high')}
        for month in range(1, 13):
            for day in (1, 15):
                origin = date(year, month, day)
                context = context_for(days, origin)
                if not np.isfinite(context[-14:]).any():
                    continue
                median, lo, hi = _quantiles(model.forecast(context, prediction_length=HORIZON), HORIZON)
                actual = [days.get(origin + timedelta(days=h), float('nan')) for h in range(1, HORIZON + 1)]
                baseline = seasonal_baseline(days, origin, HORIZON)
                valid = context[np.isfinite(context)]
                last = np.expm1(valid[-1]) if len(valid) else float('nan')
                for key, arr in [('actual', actual), ('median', median), ('seasonal', baseline),
                                 ('persistence', [last] * HORIZON), ('low', lo), ('high', hi)]:
                    yd[key].extend(arr)
        actual, pred, base, persist, lo, hi = (np.asarray(yd[k], dtype=float) for k in ('actual', 'median', 'seasonal', 'persistence', 'low', 'high'))
        mask = np.isfinite(actual) & np.isfinite(lo) & np.isfinite(hi)
        yearly[str(year)] = {'timestral': metrics(actual, pred), 'seasonal': metrics(actual, base),
                             'persistence': metrics(actual, persist),
                             'interval_10_90_coverage': float(np.mean((actual[mask] >= lo[mask]) & (actual[mask] <= hi[mask]))) if mask.any() else None}
        print(year, json.dumps(yearly[str(year)]), flush=True)
        observed.extend(actual); timestral.extend(pred); seasonal.extend(base); persistence.extend(persist); low.extend(lo); high.extend(hi)
    actual, pred, base, persist, lo, hi = map(np.asarray, (observed, timestral, seasonal, persistence, low, high))
    mask = np.isfinite(actual) & np.isfinite(lo) & np.isfinite(hi)
    peak_threshold = float(np.quantile(actual[mask], .9))
    peak = mask & (actual >= peak_threshold)
    rest = mask & ~peak
    return {'description': '7-day forecasts started on the 1st and 15th of each month 2023-2025; only days with data are scored; '
                           'inputs are the current archive, not what was available at each start date.',
            'pooled': {'timestral': metrics(actual, pred), 'seasonal': metrics(actual, base), 'persistence': metrics(actual, persist),
                       'interval_10_90_coverage': float(np.mean((actual[mask] >= lo[mask]) & (actual[mask] <= hi[mask]))),
                       'top_10_percent_threshold': peak_threshold,
                       'top_10_percent_timestral': metrics(actual[peak], pred[peak]),
                       'top_10_percent_seasonal': metrics(actual[peak], base[peak]),
                       'non_top_10_percent_timestral': metrics(actual[rest], pred[rest]),
                       'non_top_10_percent_seasonal': metrics(actual[rest], base[rest]),
                       'non_top_10_percent_persistence': metrics(actual[rest], persist[rest])},
            'by_year': yearly}


def make_forecast(days, model, origin):
    """Forecast the 7 days after `origin` (the last day of the data), with nothing after `origin` as input."""
    context = context_for({d: v for d, v in days.items() if d <= origin}, origin)
    if np.isfinite(context).sum() < 30:
        raise ValueError('Not enough days with data for a forecast')
    output = model.forecast(context, prediction_length=HORIZON)
    values = [np.asarray(output.quantile(q), dtype=float).reshape(-1)[:HORIZON] for q in (.1, .5, .9)]
    if any(len(v) != HORIZON or not np.isfinite(v).all() for v in values):
        raise ValueError('Timestral returned invalid forecast values')
    predictions = []
    for i in range(HORIZON):
        q10, median, q90 = [max(0.0, float(np.expm1(v[i]))) for v in values]
        if not q10 <= median <= q90:
            raise ValueError('Timestral returned crossed quantiles')
        predictions.append({'date': (origin + timedelta(days=i + 1)).isoformat(),
                            'median': round(median, 3), 'q10': round(q10, 3), 'q90': round(q90, 3)})
    return predictions


def build(daily: dict, model, validation=None) -> dict:
    days = daily_series(daily)
    origin = date.fromisoformat(daily["end"])
    return {
        'schema_version': daily['schema_version'], 'method_version': daily['method_version'], 'is_sample': daily['is_sample'],
        'region_id': daily['region_id'], 'kind': 'experimental_forecast',
        'model': MODEL_ID, 'model_revision': MODEL_REVISION,
        'method_source': "Yashneil Gajjala's Califire forecast (yashneil75/califire, MIT), run on the harmonized daily count",
        'origin_date': origin.isoformat(),
        'note': 'Forecast of the 7 days after the last day of the data (the standard archive ends there), not of the days after today.',
        'unit': 'MODIS-equivalent hotspots (harmonized count) per day',
        'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'warning': 'Experimental forecast of satellite-detected activity; not a fire-risk forecast or emergency guidance.',
        'predictions': make_forecast(days, model, origin),
        'validation': validation,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--region', default='US-CA')
    p.add_argument('--data', type=Path, default=ROOT / 'data/processed')
    p.add_argument('--no-backtest', action='store_true')
    a = p.parse_args()
    rdir = a.data / 'regions' / a.region
    daily = json.loads((rdir / 'daily.json').read_text(encoding='utf-8'))
    import torch
    from timestral import TimestralForecaster
    torch.set_num_threads(2)
    model = TimestralForecaster.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    validation = None if a.no_backtest else backtest(daily_series(daily), model)
    out = build(daily, model, validation)
    (rdir / 'forecast.json').write_text(json.dumps(out, indent=1, allow_nan=False) + '\n', encoding='utf-8')
    print(f"Wrote {len(out['predictions'])} predictions from {out['origin_date']} to {rdir / 'forecast.json'}")
    if validation:
        print('pooled', json.dumps(validation['pooled'], indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
