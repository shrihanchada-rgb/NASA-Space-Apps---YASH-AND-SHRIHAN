"""Tests for pipeline/01_download.py. No network: FIRMS answers are faked."""
import datetime as dt
import importlib.util
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("download", ROOT / "pipeline" / "01_download.py")
dl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dl)

D = dt.date
HEADER = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type"


def test_chunks_cover_range_in_5_day_pieces():
    got = list(dl.chunks(D(2023, 1, 1), D(2023, 1, 12)))
    assert got == [(D(2023, 1, 1), 5), (D(2023, 1, 6), 5), (D(2023, 1, 11), 2)]


def test_year_needs_73_chunks():
    assert len(list(dl.chunks(D(2023, 1, 1), D(2023, 12, 31)))) == 73


def test_clip_to_source_dates_from_config():
    none = Path("/nonexistent/availability.csv")  # force the config fallback, whatever is in data/raw
    assert dl.clip_to_source("VIIRS_NOAA21_SP", D(2022, 1, 1), D(2022, 12, 31), none) is None
    assert dl.clip_to_source("VIIRS_SNPP_SP", D(2026, 10, 1), D(2026, 12, 31), none) == (D(2026, 10, 1), D(2026, 11, 2))
    assert dl.clip_to_source("MODIS_SP", D(2000, 1, 1), D(2000, 12, 31), none) == (D(2000, 11, 1), D(2000, 12, 31))


def test_key_is_masked_in_errors():
    def get(url):
        raise urllib.error.HTTPError(url, 400, "Bad Request", {}, None)
    with pytest.raises(dl.FirmsError) as e:
        dl.fetch("https://x/api/area/csv/SECRET123/MODIS_SP/1,2,3,4/1/2023-01-01", "SECRET123", get=get, sleep=lambda s: None)
    assert "SECRET123" not in str(e.value) and "<MAP_KEY>" in str(e.value)


def test_non_csv_answer_stops():
    with pytest.raises(dl.FirmsError, match="did not return CSV"):
        dl.fetch("u", "k", get=lambda url: "Invalid MAP_KEY.", sleep=lambda s: None)


def test_retries_server_errors_then_succeeds():
    calls = []

    def get(url):
        calls.append(url)
        if len(calls) < 3:
            raise urllib.error.HTTPError(url, 503, "busy", {}, None)
        return HEADER + "\n"
    assert dl.fetch("u", "k", get=get, sleep=lambda s: None).startswith("latitude")
    assert len(calls) == 3


def test_download_writes_files_and_resumes(tmp_path):
    calls = []

    def get(url):
        calls.append(url)
        return HEADER + "\n1,2,300,1,1,2023-08-01,1030,T,MODIS,80,6.1,290,5.5,D,0\n"
    noop = dl.RateLimiter(budget=10**9)
    s = dl.download("PT", D(2023, 8, 1), D(2023, 8, 12), ["MODIS_SP"], "KEY", out=tmp_path, get=get, limiter=noop, log=lambda *a: None)
    assert len(calls) == 3 and s["MODIS_SP"]["rows"] == 3
    assert s["MODIS_SP"]["header"] == HEADER
    assert sorted(p.name for p in (tmp_path / "MODIS_SP" / "PT").iterdir()) == ["2023-08-01_5d.csv", "2023-08-06_5d.csv", "2023-08-11_2d.csv"]
    s2 = dl.download("PT", D(2023, 8, 1), D(2023, 8, 12), ["MODIS_SP"], "KEY", out=tmp_path, get=get, limiter=noop, log=lambda *a: None)
    assert len(calls) == 3 and s2["MODIS_SP"]["skipped"] == 3  # no new requests


def test_failed_chunk_leaves_no_file(tmp_path):
    def get(url):
        raise urllib.error.HTTPError(url, 400, "bad", {}, None)
    with pytest.raises(dl.FirmsError):
        dl.download("PT", D(2023, 8, 1), D(2023, 8, 3), ["MODIS_SP"], "KEY", out=tmp_path, get=get,
                    limiter=dl.RateLimiter(budget=10**9), log=lambda *a: None)
    assert list((tmp_path / "MODIS_SP" / "PT").iterdir()) == []


def test_rate_limiter_waits_when_budget_used():
    t = [0.0]
    waits = []
    rl = dl.RateLimiter(budget=10, window=600, clock=lambda: t[0], sleep=lambda s: (waits.append(s), t.__setitem__(0, t[0] + s)))
    rl.take(5)
    rl.take(5)
    assert waits == []
    rl.take(5)
    assert len(waits) == 1 and waits[0] >= 600


def test_url_has_bbox_days_and_date():
    url = dl.area_url("K", "VIIRS_NOAA20_SP", [-9.7, 36.8, -6.0, 42.3], D(2023, 8, 1), 5)
    assert url.endswith("/area/csv/K/VIIRS_NOAA20_SP/-9.7,36.8,-6,42.3/5/2023-08-01")


def test_source_dates_prefer_availability_file(tmp_path):
    f = tmp_path / "avail.csv"
    f.write_text("data_id,min_date,max_date\nVIIRS_NOAA21_SP,2023-03-01,2026-07-31\n")
    assert dl.source_dates("VIIRS_NOAA21_SP", f) == (D(2023, 3, 1), D(2026, 7, 31))
    assert dl.clip_to_source("VIIRS_NOAA21_SP", D(2026, 1, 1), D(2026, 12, 31), f) == (D(2026, 1, 1), D(2026, 7, 31))
    assert dl.source_dates("MODIS_SP", f)[0] == D(2000, 11, 1)  # not in file -> config fallback


def test_value_summary_counts_formats():
    text = HEADER + "\n1,2,300,1,1,2023-08-01,1030,T,MODIS,80,6.1,290,5.5,D,0\n1,2,300,1,1,2023-08-01,1030,A,MODIS,20,6.1,290,5.5,N,2\n"
    v = dl.value_summary([text])
    assert dict(v["satellite"]) == {"T": 1, "A": 1} and dict(v["type"]) == {"0": 1, "2": 1}
