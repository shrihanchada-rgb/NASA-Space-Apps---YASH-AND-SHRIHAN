# Data contract (pipeline → website)

Step S07. This file defines **exactly** what the pipeline writes to `data/processed/` and what the website reads. The website reads nothing else. Machine-readable versions are in `docs/schemas/` (JSON Schema, draft 2020-12). Changing this contract needs both Shrihan and Yash to agree (README Section 11.4); bump `schema_version` when you do.

Contract version: **`schema_version` = `"1.0"`**.

## 0. Rules that apply to every file

| Rule | Detail |
|---|---|
| Encoding | UTF-8. JSON files are plain JSON (no comments, no NaN). |
| Dates | `YYYY-MM-DD`, UTC day (same as FIRMS `acq_date`). |
| Times | `HHMM` as a 4-character string, UTC (FIRMS `acq_time`, zero-padded, e.g. `"0105"`). |
| Missing vs zero | **`null` = no data** (no satellite observed, or data not available). **`0` = observed, no fires**. The calendar hatches `null`, colours `0`. |
| Counts | Raw counts are integers. Harmonized counts are numbers (can be fractional, because they are scaled). |
| FRP | Megawatts (MW), as in FIRMS `frp`. |
| `is_sample` | Every JSON file has `"is_sample"`. `true` = fake fixture (only in `web/fixtures/`), `false` = real pipeline output. The website shows a "SAMPLE DATA" banner when it is `true`. |
| Versions | Every JSON file has `"schema_version"` (this contract) and `"method_version"` (the harmonization method, e.g. `"A-1.0"`; `"none"` in fixtures). |
| Region ids | Short stable strings, see §2. Used in folder names, so only `A-Z`, `0-9`, `-`. |

## 1. File layout

```
data/processed/
  metadata.json                      # §3, one file
  regions.geojson                    # §2, one file
  regions/<region_id>/monthly.json   # §4, calendar + monthly charts
  regions/<region_id>/daily.json     # §5, daily charts + any date range summary
  regions/<region_id>/baseline.json  # §6, climatology for anomaly / percentile colours
  regions/<region_id>/hotspots/<year>.csv   # §7, per-detection points for map + CSV download
  daily_grid.parquet                 # §8, pipeline-internal, NOT read by the website v1
```

`web/fixtures/` has the same layout (S08) with `is_sample: true`.

## 2. `regions.geojson`

A GeoJSON `FeatureCollection` (coordinates in WGS84 longitude/latitude). One `Feature` per selectable region, geometry `Polygon` or `MultiPolygon`.

| Property | Type | Meaning | Example |
|---|---|---|---|
| `region_id` | string | Stable id; folder name under `regions/` | `"US-CA"` |
| `name` | string | Display name | `"California"` |
| `country` | string | Country name | `"United States"` |
| `area_km2` | number | Area of the polygon, km² (for the "selected area" display) | `423970` |
| `bbox` | array of 4 numbers | `[west, south, east, north]`, used for the FIRMS area API and map zoom | `[-124.5, 32.5, -114.1, 42.0]` |
| `boundary_source` | string | Where the polygon came from (see `docs/sources.md`) | `"Natural Earth admin-1 (version recorded at download)"` |

Pilot region ids (README Section 2.1): `US-CA` (California), `BR-PA` (Pará), `AU-NSW-VIC` (New South Wales + Victoria, one merged region), `PT` (Portugal). The first two and `PT` follow ISO 3166 codes; `AU-NSW-VIC` is our own id for a merged region.

User-drawn polygons (README 3.1.1b) are not a region in this file: the website filters the region's hotspot points (§7) inside the drawn shape, and must say that drawn areas show **raw** counts weighted by `harmonized_weight`, not pre-computed monthly values.

## 3. `metadata.json`

| Field | Type | Meaning | Example |
|---|---|---|---|
| `schema_version` | string | This contract's version | `"1.0"` |
| `method_version` | string | Harmonization method used | `"A-1.0"` |
| `build_date` | string (date) | Day the pipeline produced these files | `"2026-11-20"` |
| `is_sample` | boolean | Fake fixture or real | `false` |
| `reference_scale` | string | What `count_harm` means | `"MODIS-equivalent detections"` |
| `time_coverage` | object `{start, end}` (dates) | First and last day in the processed data | `{"start": "2000-11-01", "end": "2026-11-10"}` |
| `sources` | array of objects | One per FIRMS source used: `source` (FIRMS SOURCE name), `first_date`, `last_date`, `n_detections_kept` (integer) | `{"source": "VIIRS_SNPP_SP", "first_date": "2012-01-20", "last_date": "2026-11-02", "n_detections_kept": 812345}` |
| `filters` | object | What was removed: `min_confidence` (`"low"`/`"nominal"`/`"high"`), `types_kept` (array of integers) | `{"min_confidence": "nominal", "types_kept": [0]}` |
| `grid_resolution_deg` | number | Grid cell size used in the pipeline | `0.25` |
| `regions` | array of strings | Region ids that have folders | `["US-CA", "BR-PA", "AU-NSW-VIC", "PT"]` |
| `sensor_transitions` | array of objects | Dates the calendar marks: `date`, `label` | `{"date": "2026-11-02", "label": "S-NPP ends"}` |
| `known_gaps` | array of objects | `start`, `end` (dates), `sensor` (`"MODIS"`/`"VIIRS"`/`"all"`), `note` | `{"start": "2001-06-15", "end": "2001-07-03", "sensor": "MODIS", "note": "MODIS outage (FIRMS FAQ)"}` |
| `validation` | object | Headline numbers from `docs/validation/README.md`: `r2` (number or null), `median_abs_pct_error` (number or null), `test_years` (string) | `{"r2": 0.86, "median_abs_pct_error": 21.4, "test_years": "2019-2023"}` |
| `citation` | string | Text shown on the methods page and in CSV headers | (see `docs/data-notes.md` §7) |

## 4. `regions/<region_id>/monthly.json`

Top level: `schema_version`, `method_version`, `is_sample`, `region_id`, `region_name`, `build_date`, and `months`.

`months` is an array with **one entry for every calendar month from the region's first month to its last month, with no gaps**, sorted by time. A month with no data is still present, with `null` values.

| Field | Type | Meaning | Example |
|---|---|---|---|
| `year` | integer | Year | `2020` |
| `month` | integer 1–12 | Month | `8` |
| `count_harm` | number or null | Harmonized hotspot count (MODIS-equivalent). **The number the calendar shows.** | `15230.4` |
| `count_low` | number or null | Lower end of the uncertainty band for `count_harm` (not "low confidence") | `13900.0` |
| `count_high` | number or null | Upper end of the uncertainty band for `count_harm` (not "high confidence") | `16560.2` |
| `count_raw_modis` | integer or null | Detections kept from MODIS (Terra + Aqua). `null` if MODIS had no data that month | `15010` |
| `count_raw_viirs` | integer or null | Detections kept from VIIRS (all satellites). `null` before 20 Jan 2012 | `61200` |
| `raw_by_satellite` | object | Kept detections per FIRMS satellite code (`T`, `A`, `N`, `N20`, `N21`), integers; omit satellites with no data | `{"T": 7000, "A": 8010, "N": 30100, "N20": 31100}` |
| `frp_sum_modis` | number or null | Sum of FRP of kept MODIS detections, MW | `412345.6` |
| `frp_sum_viirs` | number or null | Sum of FRP of kept VIIRS detections, MW | `398765.1` |
| `share_high_confidence` | number 0–1 or null | Fraction of kept detections (all sensors) with confidence class "high" | `0.31` |
| `n_days_observed` | integer 0–31 | Days in this month with data from at least one sensor | `31` |

Rule: if `count_harm` is `null`, then `count_low` and `count_high` are `null` too. If `count_harm` is a number, `count_low ≤ count_harm ≤ count_high`.

## 5. `regions/<region_id>/daily.json`

Column-oriented to keep the file small. Top level: `schema_version`, `method_version`, `is_sample`, `region_id`, `build_date`, `start` (date), `end` (date), and `columns`.

`columns` is an object of equal-length arrays, one element per day from `start` to `end` inclusive, no gaps:

| Column | Element type | Meaning |
|---|---|---|
| `count_harm` | number or null | Harmonized count for the day |
| `count_raw_modis` | integer or null | Kept MODIS detections |
| `count_raw_viirs` | integer or null | Kept VIIRS detections |
| `frp_sum` | number or null | Sum of FRP of all kept detections (MODIS + VIIRS), MW |

Day `i` is `start + i days`. The website sums these for any user-chosen date range (summary panel, cumulative-year curves). Daily values have no uncertainty band in v1; the website must show uncertainty only at monthly level.

Example:
```json
{"schema_version": "1.0", "method_version": "A-1.0", "is_sample": false, "region_id": "PT", "build_date": "2026-11-20",
 "start": "2000-11-01", "end": "2000-11-03",
 "columns": {"count_harm": [0, 2.0, null], "count_raw_modis": [0, 2, null], "count_raw_viirs": [null, null, null], "frp_sum": [0, 35.2, null]}}
```

## 6. `regions/<region_id>/baseline.json`

Climatology used for the **anomaly** and **percentile** colour modes. Top level: `schema_version`, `method_version`, `is_sample`, `region_id`, `build_date`, `base_period` (`{start_year, end_year}`), and `months` (exactly 12 entries, month 1–12).

| Field | Type | Meaning |
|---|---|---|
| `month` | integer 1–12 | Calendar month |
| `n_years` | integer | Years in the base period with a non-null `count_harm` for this month |
| `mean` | number or null | Mean `count_harm` |
| `std` | number or null | Standard deviation (sample, n−1) |
| `p10`, `p25`, `p50`, `p75`, `p90` | number or null | Percentiles of `count_harm` |

Definitions the website must use (so every view agrees):
- **Anomaly %** = `(count_harm − mean) / mean × 100`. If `mean` is 0 or null, anomaly is null (show hatched, with tooltip "no baseline").
- **Percentile** of a month = share of base-period years (same calendar month) with `count_harm` lower than this month's value, × 100.
- Default base period: all complete years in the data. A null in `months` (fewer than 3 years) means "no baseline".

## 7. `regions/<region_id>/hotspots/<year>.csv`

One row per kept detection in that region and year, sorted by `date`, `time_utc`. Used for the map and the hotspot CSV download (README 3.1.8). Header row required, comma-separated, no index column.

| Column | Type | Meaning | Example |
|---|---|---|---|
| `date` | date | FIRMS `acq_date` | `2020-08-19` |
| `time_utc` | string `HHMM` | FIRMS `acq_time` | `2045` |
| `latitude` | number | Pixel centre (not exact fire location) | `38.512` |
| `longitude` | number | Pixel centre | `-122.301` |
| `sensor` | `MODIS` or `VIIRS` | Instrument | `VIIRS` |
| `satellite` | `T`, `A`, `N`, `N20`, `N21` | FIRMS satellite code | `N20` |
| `confidence` | `low`, `nominal`, `high` | Unified class (MODIS converted with thresholds in `docs/data-notes.md` §4) | `nominal` |
| `frp` | number | Fire radiative power, MW | `12.4` |
| `daynight` | `D` or `N` | Day or night detection | `D` |
| `harmonized_weight` | number | This detection's contribution to `count_harm` (MODIS rows = 1; VIIRS rows = the scaling factor used for that place and month) | `0.27` |
| `region_id` | string | Region this row belongs to | `US-CA` |

The downloaded CSV adds comment lines starting with `#` above the header: the query (region, dates), `method_version`, `build_date`, and the `citation` from `metadata.json`.

## 8. `daily_grid.parquet` (pipeline only)

Not read by the website v1. Columns: `date` (date), `cell_id` (string, `"<lat_index>_<lon_index>"` on the `grid_resolution_deg` grid), `count_raw_modis` (int), `count_raw_viirs` (int), `count_harm` (float), `frp_sum` (float). Kept so validation and future features can re-aggregate.

## 8b. Proposed additions (written by step 06 since 2026-11-15; **not yet agreed by both people**)

The website may ignore these files; contract 1.0 files are unchanged. They exist so results can follow an area the user chooses inside the region without loading every detection. Yash: please accept, change or reject.

| File | Columns / fields |
|---|---|
| `regions/<id>/grid_cells.csv` | `lat_idx`, `lon_idx` (cell = `floor((lat + 90) / 0.25)`, `floor((lon + 180) / 0.25)`), `lat`, `lon` (cell centre), `share_in_region` (0–1) |
| `regions/<id>/grid_monthly.csv` | `year`, `month`, `lat_idx`, `lon_idx`, `count_harm`, `count_raw_modis`, `count_raw_viirs`, `frp_sum`; only cells with at least one detection that month (absent = 0 if the month has data) |
| `regions/<id>/harmonization_check.json` | per overlap month: `modis_observed`, `snpp_detections`, `modis_equivalent_from_snpp`, `range_low`, `range_high`; plus `k_by_calendar_month` |

Clarifications of contract 1.0 found when the first real files were built (no change of meaning):
- **`harmonized_weight`:** weights of all rows of a month add up to `count_harm`. Rows of satellites that do not enter `count_harm` (NOAA-20, NOAA-21, and all VIIRS under the `modis_first` policy) have weight 0.
- **A null raw count** (`count_raw_viirs` before 20 Jan 2012) means no rows of that sensor in the hotspot files; `scripts/validate_data.py` now accepts this.
- **`count_low` = `count_harm` = `count_high`** where the value is purely observed MODIS.

## 9. How each website feature maps to files

| Website feature (README 3.1) | Reads |
|---|---|
| Region list, map outline, area km² | `regions.geojson` |
| Summary panel for a date range | `daily.json` (+ `monthly.json` for `share_high_confidence`) |
| Calendar (absolute colours) | `monthly.json` |
| Calendar (percentile / anomaly colours) | `monthly.json` + `baseline.json` |
| Sensor-transition markers, "SAMPLE DATA" banner, citation | `metadata.json` |
| Monthly series with uncertainty band | `monthly.json` |
| Daily bars, cumulative-year curves | `daily.json` |
| Map points, hotspot CSV download, drawn-area filter | `hotspots/<year>.csv` |
| Methods page numbers | `metadata.json` (`validation`, `filters`, `sources`, `known_gaps`) |

## 10. Open questions (decide before S17)

1. Whether hotspot CSVs need compression for the largest region-years (size unknown until S10).
2. Whether the uncertainty band (`count_low`/`count_high`) is a 90% or 95% interval: set by the method chosen in S16, then written in `docs/validation/README.md`.
3. Field names `count_low`/`count_high` can be confused with confidence classes. Kept to match README Section 11.4; renaming needs both people to agree.
