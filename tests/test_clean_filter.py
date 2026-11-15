"""Tests for pipeline/02_clean.py, 03_filter.py and 03b_sanity_checks.py. No network, no real downloads.

"Known rows" are copied exactly from real FIRMS SP files in Shrihan's Drive (PT region):
MODIS_SP/PT/2017-10-18_5d.csv and VIIRS_SNPP_SP/PT/2019-01-18_5d.csv. Rows marked SYNTHETIC are invented
to test edge cases (confidence thresholds, year boundaries, duplicates) and are not data.
"""
import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import common  # noqa: E402
import config  # noqa: E402


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / "pipeline" / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


clean = load("clean", "02_clean.py")
filt = load("filt", "03_filter.py")
sanity = load("sanity", "03b_sanity_checks.py")

MODIS_HEADER = ",".join(common.MODIS_HEADER)
VIIRS_HEADER = ",".join(common.VIIRS_HEADER)
# Real rows (MODIS_SP/PT/2017-10-18_5d.csv)
MODIS_KNOWN = [
    "40.4552,-8.697,304.1,1.3,1.1,2017-10-18,1150,Terra,MODIS,58,6.03,292.1,6.2,D,0",
    "40.458,-8.7118,304.3,1.3,1.1,2017-10-18,1150,Terra,MODIS,58,6.03,291.7,6.1,D,0",
    "40.4281,-8.7194,307.1,1.2,1.1,2017-10-18,1329,Aqua,MODIS,53,6.03,293.7,5.8,D,0",
    "40.4492,-8.7117,311.7,1.2,1.1,2017-10-18,1329,Aqua,MODIS,72,6.03,293.6,10,D,0",
    "38.3492,-6.1535,307.6,1,1,2017-10-22,1126,Terra,MODIS,41,6.03,296,4.3,D,0",
]
# Real rows (VIIRS_SNPP_SP/PT/2019-01-18_5d.csv)
VIIRS_KNOWN = [
    "38.50142,-8.93459,308.55,0.54,0.42,2019-01-18,250,N,VIIRS,n,2,275.68,1.98,N,2",
    "38.92122,-9.00786,315.21,0.52,0.42,2019-01-18,250,N,VIIRS,n,2,279.54,2.3,N,3",
    "38.00736,-7.85944,327.72,0.5,0.66,2019-01-18,1232,N,VIIRS,n,2,280.61,1.32,D,0",
    "37.92354,-8.58939,295.15,0.39,0.36,2019-01-19,232,N,VIIRS,n,2,279.13,0.4,N,0",
    "38.27409,-8.38436,332.34,0.45,0.39,2019-01-21,1315,N,VIIRS,n,2,287.43,4.72,D,0",
]


def frame(header, rows):
    from io import StringIO
    return pd.read_csv(StringIO("\n".join([header] + rows)), dtype=str, keep_default_na=False)


def write_chunk(raw, source, region, first, n, header, rows):
    folder = raw / source / region
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{first}_{n}d.csv").write_text("\n".join([header] + rows) + "\n")


def modis_row(date, time="1150", sat="Terra", conf="58", lat="40.0", lon="-8.0", typ="0", frp="5.0"):
    """SYNTHETIC MODIS row."""
    return f"{lat},{lon},304.1,1.3,1.1,{date},{time},{sat},MODIS,{conf},6.03,292.1,{frp},D,{typ}"


def viirs_row(date, time="1315", sat="N", conf="n", lat="38.0", lon="-8.0", typ="0", frp="2.0"):
    """SYNTHETIC VIIRS row."""
    return f"{lat},{lon},330.0,0.45,0.39,{date},{time},{sat},VIIRS,{conf},2,287.0,{frp},D,{typ}"


# ---------- S11 clean ----------

def test_known_modis_rows():
    out = clean.normalize(frame(MODIS_HEADER, MODIS_KNOWN), "PT", "MODIS_SP")
    assert list(out["satellite"]) == ["T", "T", "A", "A", "T"]          # Terra/Aqua -> T/A
    assert list(out["confidence"]) == ["nominal"] * 5                   # 58, 58, 53, 72, 41 are all 30-79
    assert list(out["confidence_raw"]) == ["58", "58", "53", "72", "41"]
    assert list(out["time_utc"]) == ["1150", "1150", "1329", "1329", "1126"]
    assert list(out["sensor"].unique()) == ["MODIS"]
    assert out.loc[0, "latitude"] == 40.4552 and out.loc[0, "longitude"] == -8.697
    assert out.loc[3, "frp"] == 10.0 and out.loc[0, "brightness"] == 304.1 and out.loc[0, "bright_bg"] == 292.1
    assert list(out["version"].unique()) == ["6.03"]


def test_known_viirs_rows():
    out = clean.normalize(frame(VIIRS_HEADER, VIIRS_KNOWN), "PT", "VIIRS_SNPP_SP")
    assert list(out["time_utc"]) == ["0250", "0250", "1232", "0232", "1315"]   # FIRMS drops leading zeros
    assert list(out["confidence"]) == ["nominal"] * 5
    assert list(out["type"]) == [2, 3, 0, 0, 0]
    assert list(out["satellite"].unique()) == ["N"]
    assert out.loc[0, "brightness"] == 308.55 and out.loc[0, "bright_bg"] == 275.68


def test_modis_confidence_thresholds():
    rows = [modis_row("2017-10-18", conf=c) for c in ("0", "29", "30", "79", "80", "100")]
    out = clean.normalize(frame(MODIS_HEADER, rows), "PT", "MODIS_SP")
    assert list(out["confidence"]) == ["low", "low", "nominal", "nominal", "high", "high"]


@pytest.mark.parametrize("bad", [modis_row("2017-10-18", sat="Landsat"), modis_row("2017-10-18", conf="h"),
                                 modis_row("2017-10-18", time="2460"), modis_row("2017-13-01"),
                                 modis_row("2017-10-18", typ="5")])
def test_bad_values_stop_cleaning(bad):
    with pytest.raises(clean.CleanError):
        clean.normalize(frame(MODIS_HEADER, [bad]), "PT", "MODIS_SP")


def test_same_schema_for_modis_viirs_and_empty():
    a = clean.normalize(frame(MODIS_HEADER, MODIS_KNOWN), "PT", "MODIS_SP")
    b = clean.normalize(frame(VIIRS_HEADER, VIIRS_KNOWN), "PT", "VIIRS_SNPP_SP")
    e = clean.empty_frame()
    expected = list(common.CLEAN_COLUMNS)
    for df in (a, b, e):
        assert list(df.columns) == expected
        assert {c: str(t) for c, t in df.dtypes.items()} == {c: str(pd.Series(dtype=t).dtype) for c, t in common.CLEAN_COLUMNS.items()}


def test_year_boundary_chunk_counts_each_row_once(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "clean"
    # A chunk spanning New Year (2023-12-30 .. 2024-01-03) and the next one.
    write_chunk(raw, "MODIS_SP", "PT", "2023-12-30", 5, MODIS_HEADER,
                [modis_row("2023-12-30"), modis_row("2023-12-31", lat="41"), modis_row("2024-01-02")])
    write_chunk(raw, "MODIS_SP", "PT", "2024-01-04", 5, MODIS_HEADER, [modis_row("2024-01-05")])
    reps = clean.clean_region_source("PT", "MODIS_SP", raw=raw, out=out, log=lambda *_: None)
    by_year = {r["year"]: r["rows_out"] for r in reps}
    assert by_year == {2023: 2, 2024: 2}
    assert sum(by_year.values()) == clean.raw_row_count(common.chunk_files(raw / "MODIS_SP" / "PT")) == 4
    assert len(pd.read_parquet(out / "PT" / "MODIS_SP" / "2024.parquet")) == 2


def test_overlapping_test_chunks_are_not_double_counted(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "clean"
    a, b = modis_row("2023-01-02"), modis_row("2023-01-03", lat="41.1")
    # Full-range chunk (2022-12-31 .. 2023-01-04) and an S09-style test chunk (2023-01-01 ..) with the same rows.
    write_chunk(raw, "MODIS_SP", "US-CA", "2022-12-31", 5, MODIS_HEADER, [modis_row("2022-12-31", lat="35"), a, b])
    write_chunk(raw, "MODIS_SP", "US-CA", "2023-01-01", 5, MODIS_HEADER, [a, b])
    reps = {r["year"]: r for r in clean.clean_region_source("US-CA", "MODIS_SP", raw=raw, out=out, log=lambda *_: None)}
    assert reps[2023]["rows_read"] == 4 and reps[2023]["duplicates_dropped"] == 2 and reps[2023]["rows_out"] == 2
    assert reps[2022]["rows_out"] == 1


def test_rerun_overwrites_and_does_not_add_rows(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "clean"
    write_chunk(raw, "VIIRS_SNPP_SP", "PT", "2019-01-18", 5, VIIRS_HEADER, VIIRS_KNOWN)
    for _ in range(2):
        clean.clean_region_source("PT", "VIIRS_SNPP_SP", raw=raw, out=out, force=True, log=lambda *_: None)
    assert len(pd.read_parquet(out / "PT" / "VIIRS_SNPP_SP" / "2019.parquet")) == 5
    rep = json.loads((out / "PT" / "VIIRS_SNPP_SP" / "2019.json").read_text())
    assert rep["rows_out"] == 5 and rep["duplicates_dropped"] == 0


def test_header_only_chunk_gives_empty_year_with_schema(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "clean"
    write_chunk(raw, "VIIRS_NOAA21_SP", "PT", "2023-03-01", 5, VIIRS_HEADER, [])
    reps = clean.clean_region_source("PT", "VIIRS_NOAA21_SP", raw=raw, out=out, log=lambda *_: None)
    assert reps[0]["rows_out"] == 0
    df = pd.read_parquet(out / "PT" / "VIIRS_NOAA21_SP" / "2023.parquet")
    assert len(df) == 0 and list(df.columns) == list(common.CLEAN_COLUMNS)


def test_version_ranges_report(tmp_path):
    reps = [{"region_id": "PT", "source": "MODIS_SP", "versions": {"6.03": {"rows": 3, "first_date": "2001-01-01", "last_date": "2021-12-31"}}},
            {"region_id": "PT", "source": "MODIS_SP", "versions": {"61.03": {"rows": 2, "first_date": "2022-01-01", "last_date": "2022-12-31"},
                                                                    "6.03": {"rows": 1, "first_date": "2022-01-01", "last_date": "2022-01-02"}}}]
    for r in reps:
        r.update({k: 0 for k in ("year", "files", "rows_read", "duplicates_dropped", "rows_out", "rows_outside_file_window", "rows_outside_download_box")})
        r.update(first_date=None, last_date=None, by_satellite={}, by_confidence={}, by_type={})
    clean.write_reports(reps, tmp_path)
    lines = (tmp_path / "clean_versions.csv").read_text().splitlines()
    assert "PT,MODIS_SP,6.03,4,2001-01-01,2022-01-02" in lines
    assert "PT,MODIS_SP,61.03,2,2022-01-01,2022-12-31" in lines


# ---------- S12 filter ----------

def test_filter_counts_each_removed_row_once():
    rows = [viirs_row("2019-01-18", conf="l", typ="2"),   # non-vegetation AND low: counted as type only
            viirs_row("2019-01-18", conf="l", lat="38.1"),  # low confidence
            viirs_row("2019-01-18", conf="n", typ="3", lat="38.2"),
            viirs_row("2019-01-18", conf="n", lat="38.3"),
            viirs_row("2019-01-18", conf="h", lat="38.4")]
    df = clean.normalize(frame(VIIRS_HEADER, rows), "PT", "VIIRS_SNPP_SP")
    kept, c = filt.filter_frame(df)
    assert (c["rows_in"], c["removed_type"], c["removed_low_confidence"], c["rows_out"]) == (5, 2, 1, 2)
    assert c["removed_type_2"] == 1 and c["removed_type_3"] == 1
    assert set(kept["confidence"]) == {"nominal", "high"} and set(kept["type"]) == {0}
    assert list(kept.columns) == list(common.CLEAN_COLUMNS)


def test_filter_settings_can_change():
    df = clean.normalize(frame(VIIRS_HEADER, VIIRS_KNOWN), "PT", "VIIRS_SNPP_SP")
    _, c = filt.filter_frame(df, min_confidence="low", types_kept=(0, 2, 3))
    assert c["rows_out"] == 5
    assert config.FILTER_MIN_CONFIDENCE == "nominal" and tuple(config.FILTER_TYPES_KEPT) == (0,)  # matches data contract example


# ---------- end to end + S13 checks ----------

def test_pipeline_end_to_end_and_sanity_checks(tmp_path):
    raw = tmp_path / "raw"
    avail = tmp_path / "availability.csv"
    avail.write_text("data_id,min_date,max_date\nMODIS_SP,2002-06-01,2002-07-30\nVIIRS_SNPP_SP,2012-01-20,2012-01-24\n")
    # MODIS: June and July 2002, but the chunk 2002-06-11 is missing (a download bug).
    days = [dt.date(2002, 6, 1) + dt.timedelta(days=5 * i) for i in range(12)]
    for d in days:
        if d.isoformat() == "2002-06-11":
            continue
        rows = [modis_row(d.isoformat(), lat=str(40 + i / 100)) for i in range(3)]
        rows.append(modis_row(d.isoformat(), conf="10", lat="41.5"))         # low confidence
        rows.append(modis_row(d.isoformat(), typ="2", lat="41.6"))           # static source
        if d.month == 7:
            rows.append(modis_row(d.isoformat(), sat="Aqua", lat="41.7"))   # Aqua from July 2002
        write_chunk(raw, "MODIS_SP", "PT", d.isoformat(), 5, MODIS_HEADER, rows)
    write_chunk(raw, "VIIRS_SNPP_SP", "PT", "2012-01-20", 5, VIIRS_HEADER, VIIRS_KNOWN)

    cl, fi, rep, val = tmp_path / "clean", tmp_path / "filtered", tmp_path / "reports", tmp_path / "validation"
    for s in ("MODIS_SP", "VIIRS_SNPP_SP"):
        clean.clean_region_source("PT", s, raw=raw, out=cl, log=lambda *_: None)
    rows = filt.run(["PT"], ["MODIS_SP", "VIIRS_SNPP_SP"], "nominal", (0,), clean=cl, out=fi)
    filt.write_reports(rows, rep)
    m = [r for r in rows if r["source"] == "MODIS_SP"][0]
    assert (m["rows_in"], m["removed_type"], m["removed_low_confidence"], m["rows_out"]) == (11 * 5 + 6, 11, 11, 39)
    sanity.run(["PT"], raw=raw, clean=cl, filtered=fi, reports=rep, out=val, availability=avail, log=lambda *_: None)

    gaps = pd.read_csv(val / "gaps.csv")
    miss = gaps[gaps["kind"] == "missing_download"]
    assert list(zip(miss["source"], miss["start"], miss["end"])) == [("MODIS_SP", "2002-06-11", "2002-06-15")]
    # Aqua is checked only from 4 July 2002, and it has July data: no zero-month rows for Aqua.
    assert not ((gaps["satellite"] == "A") & gaps["kind"].str.startswith("zero")).any()
    yearly = pd.read_csv(val / "yearly_counts.csv")
    assert int(yearly[(yearly["satellite"] == "T")]["count"].sum()) == 33   # 11 chunks x 3 kept Terra rows
    for f in ("PT_yearly.png", "PT_monthly.png", "monthly_counts.csv", "checks_summary.md"):
        assert (val / f).exists()
    text = (val / "checks_summary.md").read_text()
    assert "MODIS peak months" in text and "Missing-download ranges: 1" in text


# ---------- interim extract (03c) ----------

extract = load("extract", "03c_interim_extract.py")


def test_interim_extract_counts_match_files(tmp_path):
    raw, cl, fi, out = tmp_path / "raw", tmp_path / "clean", tmp_path / "filtered", tmp_path / "extract"
    avail = tmp_path / "availability.csv"
    avail.write_text("data_id,min_date,max_date\nVIIRS_SNPP_SP,2019-01-18,2019-01-27\n")
    write_chunk(raw, "VIIRS_SNPP_SP", "PT", "2019-01-18", 5, VIIRS_HEADER, VIIRS_KNOWN)   # real rows
    clean.clean_region_source("PT", "VIIRS_SNPP_SP", raw=raw, out=cl, log=lambda *_: None)
    filt.run(["PT"], ["VIIRS_SNPP_SP"], "nominal", (0,), clean=cl, out=fi)
    m = extract.build(["PT"], out=out, raw=raw, clean=cl, filtered=fi, availability=avail, log=lambda *_: None)
    d = pd.read_csv(out / "daily_counts.csv")
    assert m["n_clean_total"] == 5 and m["n_kept_total"] == 3          # 2 rows are type 2 / 3
    assert int(d["n_clean"].sum()) == 5 and int(d["n_kept"].sum()) == 3
    assert list(d.columns) == extract.DAILY_COLUMNS
    assert d[d["date"] == "2019-01-18"]["n_clean"].sum() == 3
    cov = pd.read_csv(out / "coverage.csv").iloc[0]
    assert (cov["days_downloaded"], cov["days_missing"], cov["missing_first"]) == (5, 5, "2019-01-23")
    s = pd.read_csv(out / "samples" / "PT__VIIRS_SNPP_SP.csv")
    assert len(s) == 3 and list(s.columns) == list(common.CLEAN_COLUMNS)


# ---------- S14 grid and dedupe ----------

grid = load("grid", "04_dedupe_and_grid.py")
# A square "region" 10.0-11.0 N, 20.0-21.0 E inside a download box 9.5-11.5 N, 19.5-21.5 E. SYNTHETIC.
SQUARE = [[[[20.0, 10.0], [21.0, 10.0], [21.0, 11.0], [20.0, 11.0], [20.0, 10.0]]]]


def grid_rows(rows):
    """rows: (date, sat, lat, lon, daynight, frp) -> frame like the filtered files. SYNTHETIC."""
    return pd.DataFrame(rows, columns=["date", "satellite", "latitude", "longitude", "daynight", "frp"]).assign(
        sensor=lambda d: d["satellite"].map(lambda s: "MODIS" if s in ("T", "A") else "VIIRS"))


def square_mask():
    return grid.RegionMask("X", polygons=SQUARE, bbox=[19.5, 9.5, 21.5, 11.5])


def test_region_mask_and_cells():
    m = square_mask()
    la, lo = grid.sub_index([10.5, 10.5, 9.9, 11.2], [20.5, 21.3, 20.5, 20.5])
    assert list(m.contains(la, lo)) == [True, False, False, False]
    cells = m.cells()
    assert len(cells) == 16 and (cells["share_in_region"] == 1.0).all()   # 4 x 4 cells of 0.25 degrees


def test_grid_counts_every_detection_once_and_clips():
    df = grid_rows([
        ("2020-01-01", "N", 10.501, 20.501, "D", 2.0),    # three VIIRS pixels in the same ~1 km box, same half-day
        ("2020-01-01", "N", 10.503, 20.504, "D", 3.0),
        ("2020-01-01", "N", 10.507, 20.508, "D", 1.0),
        ("2020-01-01", "N", 10.507, 20.508, "N", 1.5),    # same box at night: a separate count
        ("2020-01-01", "N", 10.530, 20.530, "D", 1.0),    # another box, same 0.25-degree cell
        ("2020-01-01", "A", 10.505, 20.505, "D", 9.0),    # another satellite: its own row
        ("2020-01-02", "N", 10.900, 20.100, "D", 1.0),    # another day and cell
        ("2020-01-01", "N", 9.800, 20.500, "D", 7.0),     # outside the region (south)
        ("2020-01-01", "T", 10.500, 21.200, "D", 7.0),    # outside the region (east)
    ])
    g, rows_in, outside = grid.grid_frame(df, square_mask())
    assert (rows_in, outside, int(g["n"].sum())) == (9, 2, 7)       # nothing lost, nothing counted twice
    row = g[(g["date"] == "2020-01-01") & (g["satellite"] == "N")].iloc[0]
    assert (row["n"], row["n_night"], row["n_px1km"], row["frp_sum"]) == (5, 1, 3, 8.5)
    assert grid.cell_id(row["lat_idx"], row["lon_idx"]) == "402_802"   # (10.5+90)/0.25, (20.5+180)/0.25
    assert len(g) == 3 and set(g["satellite"]) == {"N", "A"}
    m = grid.to_monthly(g)
    assert int(m["n"].sum()) == 7 and int(m[m["satellite"] == "N"]["days_active"].sum()) == 2


def test_grid_region_run_writes_files_and_checks(tmp_path):
    fi, out = tmp_path / "filtered", tmp_path / "grid"
    rows = [viirs_row("2019-01-18", lat="10.5", lon="20.5"), viirs_row("2019-01-18", lat="10.6", lon="20.9"),
            viirs_row("2019-02-03", lat="10.5", lon="20.5"), viirs_row("2019-02-03", lat="12.0", lon="20.5")]
    df = clean.normalize(frame(VIIRS_HEADER, rows), "PT", "VIIRS_SNPP_SP")
    (fi / "PT" / "VIIRS_SNPP_SP").mkdir(parents=True)
    df.to_parquet(fi / "PT" / "VIIRS_SNPP_SP" / "2019.parquet", index=False)
    summary, m, cells = grid.run_region("PT", filtered=fi, out=out, mask=square_mask(), log=lambda *_: None)
    assert (summary[0]["rows_in"], summary[0]["rows_outside_region"], summary[0]["rows_gridded"]) == (4, 1, 3)
    daily = pd.read_parquet(out / "daily" / "PT" / "2019.parquet")
    assert int(daily["n"].sum()) == 3
    mon = pd.read_parquet(out / "monthly" / "PT__N.parquet")
    assert sorted(zip(mon["year"], mon["month"], mon["n"])) == [(2019, 1, 1), (2019, 1, 1), (2019, 2, 1)]
    rm = grid.region_monthly("PT", m)
    assert list(rm["n"]) == [2, 1] and list(rm["cells_active"]) == [2, 1]
