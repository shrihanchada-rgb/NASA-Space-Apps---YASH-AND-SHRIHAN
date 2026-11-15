"""Shared helpers for pipeline steps 02 onward: paths, the cleaned-data schema, reading raw chunk files.

The schema here is the one shape every cleaned and filtered file has, for every region and source
(documented in docs/pipeline-files.md). Change it only together with that document and the tests.
"""
import csv
import datetime as dt
import re
from pathlib import Path

import config

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
CLEAN = INTERIM / "clean"
FILTERED = INTERIM / "filtered"
REPORTS = INTERIM / "reports"

SOURCES = tuple(config.SENSOR_OF_SOURCE)

MODIS_HEADER = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time", "satellite",
                "instrument", "confidence", "version", "bright_t31", "frp", "daynight", "type"]
VIIRS_HEADER = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time", "satellite",
                "instrument", "confidence", "version", "bright_ti5", "frp", "daynight", "type"]

# Cleaned schema: column name -> pandas dtype. Order is fixed.
CLEAN_COLUMNS = {
    "region_id": "string",
    "source": "string",          # FIRMS source, e.g. VIIRS_NOAA20_SP
    "sensor": "string",          # MODIS or VIIRS
    "satellite": "string",       # T, A, N, N20, N21
    "date": "string",            # YYYY-MM-DD (FIRMS acq_date, UTC)
    "time_utc": "string",        # HHMM, zero-padded (FIRMS acq_time)
    "latitude": "float64",
    "longitude": "float64",
    "confidence": "string",      # low, nominal, high
    "confidence_raw": "string",  # FIRMS value as given: 0-100 (MODIS) or l/n/h (VIIRS)
    "type": "int8",              # 0 vegetation, 1 volcano, 2 static land source, 3 offshore
    "frp": "float64",            # MW
    "daynight": "string",        # D or N
    "brightness": "float64",     # MODIS brightness / VIIRS bright_ti4 (K)
    "bright_bg": "float64",      # MODIS bright_t31 / VIIRS bright_ti5 (K)
    "scan": "float64",
    "track": "float64",
    "version": "string",         # FIRMS collection version, e.g. 6.03, 61.03, 2
}

CHUNK_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d+)d\.csv$")


def parse_chunk_name(name):
    """'2017-10-18_5d.csv' -> (date(2017, 10, 18), 5). None for any other file name."""
    m = CHUNK_NAME.match(name)
    if not m:
        return None
    return dt.date.fromisoformat(m.group(1)), int(m.group(2))


def chunk_files(folder):
    """All raw chunk files in a folder as (path, first_day, last_day), sorted by first day."""
    out = []
    for p in sorted(Path(folder).glob("*.csv")):
        parsed = parse_chunk_name(p.name)
        if parsed:
            first, n = parsed
            out.append((p, first, first + dt.timedelta(days=n - 1)))
    return sorted(out, key=lambda t: (t[1], t[2], t[0].name))


def files_for_year(files, year):
    """Chunk files whose date range touches `year` (a file spanning New Year belongs to both years)."""
    lo, hi = dt.date(year, 1, 1), dt.date(year, 12, 31)
    return [f for f in files if f[1] <= hi and f[2] >= lo]


def years_of(files):
    return sorted({y for _, first, last in files for y in range(first.year, last.year + 1)})


def source_dates(source, availability=None):
    """(first, last) dates FIRMS offers for a source: data/raw/data_availability.csv if present, else config."""
    path = Path(availability) if availability is not None else RAW / "data_availability.csv"
    if path.exists():
        for row in csv.DictReader(path.read_text().splitlines()):
            if row.get("data_id") == source:
                return dt.date.fromisoformat(row["min_date"]), dt.date.fromisoformat(row["max_date"])
    return config.SOURCES[source]


def regions_present(base, sources=SOURCES):
    """Region ids that have a folder under base/<SOURCE>/ for at least one source, in config order."""
    found = {p.name for s in sources if (Path(base) / s).is_dir() for p in (Path(base) / s).iterdir() if p.is_dir()}
    return [r for r in config.REGIONS if r in found]


def year_path(base, region, source, year, suffix=".parquet"):
    return Path(base) / region / source / f"{year}{suffix}"
