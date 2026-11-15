"""Shared settings for the pipeline. Facts come from docs/data-notes.md (checked 2026-11-14)."""
import datetime as dt

# FIRMS standard-processing sources and the dates the FIRMS FAQ gives for each satellite.
# These are fallbacks. When data/raw/data_availability.csv exists (01_download.py --check-availability),
# its min/max dates are used instead. On 2026-11-14 FIRMS reported SP ranges ending 2026-07-31 (VIIRS)
# and 2026-08-31 (MODIS), and VIIRS_NOAA21_SP starting 2023-03-01 (earlier than the FAQ date).
SOURCES = {
    "MODIS_SP": (dt.date(2000, 11, 1), None),          # Terra from 1 Nov 2000; Aqua from July 2002
    "VIIRS_SNPP_SP": (dt.date(2012, 1, 20), dt.date(2026, 11, 2)),  # S-NPP ended 2 Nov 2026
    "VIIRS_NOAA20_SP": (dt.date(2018, 4, 1), None),
    "VIIRS_NOAA21_SP": (dt.date(2023, 3, 1), None),  # FIRMS availability; FAQ says 17 Jan 2024
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

# Project scope (decided by Shrihan, 2026-11-15): the product covers California only.
# The other three regions stay defined above so their archived data and the 4-region validation can still be
# re-run with --region, but every script works on ACTIVE_REGIONS by default.
ACTIVE_REGIONS = ["US-CA"]
ARCHIVED_REGIONS = ["BR-PA", "AU-NSW-VIC", "PT"]

API_BASE = "https://firms.modaps.eosdis.nasa.gov/api"
MAX_DAY_RANGE = 5                 # FIRMS area API allows 1..5 days per call
TRANSACTION_LIMIT = 5000          # per MAP_KEY per 10 minutes
TRANSACTION_BUDGET = 3000         # stay well under the limit (FIRMS's server count was higher than its formula)
WINDOW_SECONDS = 600

# --- Cleaning, filtering and checks (steps S11-S13) ---
# Sensor and satellite codes used after cleaning (data contract: T, A, N, N20, N21).
SENSOR_OF_SOURCE = {"MODIS_SP": "MODIS", "VIIRS_SNPP_SP": "VIIRS", "VIIRS_NOAA20_SP": "VIIRS", "VIIRS_NOAA21_SP": "VIIRS"}
SATELLITE_CODES = {"Terra": "T", "Aqua": "A", "T": "T", "A": "A", "N": "N", "N20": "N20", "N21": "N21"}
# MODIS confidence (0-100 %) to classes, MODIS user guide Table 11 (docs/data-notes.md section 4).
MODIS_CONFIDENCE_LOW_BELOW = 30     # 0-29 low
MODIS_CONFIDENCE_HIGH_FROM = 80     # 30-79 nominal, 80-100 high
VIIRS_CONFIDENCE = {"l": "low", "n": "nominal", "h": "high"}
# Default filter (data contract metadata.filters): keep nominal + high confidence, vegetation fires only.
FILTER_MIN_CONFIDENCE = "nominal"
FILTER_TYPES_KEPT = (0,)
# First day each satellite delivers data (for gap checks). Terra and Aqua from the FIRMS FAQ (data-notes section 1);
# VIIRS from the FIRMS availability answer (2026-11-14). Aqua's first MODIS fire data: 4 July 2002.
SATELLITE_FIRST_DAY = {
    "T": dt.date(2000, 11, 1), "A": dt.date(2002, 7, 4),
    "N": dt.date(2012, 1, 20), "N20": dt.date(2018, 4, 1), "N21": dt.date(2023, 3, 1),
}

# --- Gridding and harmonization (steps S14-S16) ---
GRID_DEG = 0.25          # analysis grid (data contract: grid_resolution_deg)
SUBGRID_DEG = 0.01       # about 1 km: MODIS-footprint-sized boxes used for dedupe / Candidate B, and the clipping mask
TRAIN_YEARS = (2014, 2018)   # README Section 13 Step C
TEST_YEARS = (2019, 2023)
VIIRS_REFERENCE_SATELLITE = "N"   # S-NPP: the only VIIRS satellite covering train and test years

# How MODIS and VIIRS are combined into count_harm on days when both have data (step 06):
#   "blend"       half observed MODIS + half MODIS-equivalent from S-NPP (k[month] x S-NPP). Uses both sensors.
#   "modis_first" observed MODIS only; converted VIIRS is used only where MODIS has no data.
HARMONIZE_POLICY = "blend"
