"""Shared settings for the pipeline. Facts come from docs/data-notes.md (checked 2026-11-14)."""
import datetime as dt

# FIRMS standard-processing sources and the dates the FIRMS FAQ gives for each satellite.
# The exact _SP ranges come from /api/data_availability/ (run 01_download.py --check-availability).
SOURCES = {
    "MODIS_SP": (dt.date(2000, 11, 1), None),          # Terra from 1 Nov 2000; Aqua from July 2002
    "VIIRS_SNPP_SP": (dt.date(2012, 1, 20), dt.date(2026, 11, 2)),  # S-NPP ended 2 Nov 2026
    "VIIRS_NOAA20_SP": (dt.date(2018, 4, 1), None),
    "VIIRS_NOAA21_SP": (dt.date(2024, 1, 17), None),
}

# Download boxes: [west, south, east, north]. These are APPROXIMATE boxes drawn generously around
# each pilot region, used only to ask FIRMS for data. Points are clipped to the real boundary later
# (Natural Earth, see docs/sources.md). Not checked against an official boundary file yet.
REGIONS = {
    "US-CA": {"name": "California", "bbox": [-124.6, 32.4, -114.0, 42.1]},
    "BR-PA": {"name": "Para", "bbox": [-59.0, -10.0, -45.8, 2.8]},
    "AU-NSW-VIC": {"name": "New South Wales + Victoria", "bbox": [140.8, -39.3, 153.8, -28.0]},
    "PT": {"name": "Portugal (mainland)", "bbox": [-9.7, 36.8, -6.0, 42.3]},
}

API_BASE = "https://firms.modaps.eosdis.nasa.gov/api"
MAX_DAY_RANGE = 5                 # FIRMS area API allows 1..5 days per call
TRANSACTION_LIMIT = 5000          # per MAP_KEY per 10 minutes
TRANSACTION_BUDGET = 4000         # stay safely under the limit
WINDOW_SECONDS = 600
