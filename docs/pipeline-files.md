# Pipeline files (inside the pipeline, before the app files)

What steps 01–03b write, where, and in what shape. Every region and every source uses the same layout and the same columns, so any script (or AI) can read any file the same way. The app never reads these files; it reads `data/processed/` (`docs/data-contract.md`).

In Colab, `data/raw/` and `data/interim/` are on Google Drive: `My Drive/nasa-fire-calendar/raw/` and `.../interim/`.

## Layout

| Path | Written by | One file per | Notes |
|---|---|---|---|
| `data/raw/<SOURCE>/<REGION>/<YYYY-MM-DD>_<n>d.csv` | `01_download.py` (S10) | FIRMS request (n ≤ 5 days) | FIRMS CSV exactly as received |
| `data/raw/data_availability.csv` | `01_download.py --check-availability` | — | FIRMS date range per source |
| `data/interim/clean/<REGION>/<SOURCE>/<YEAR>.parquet` | `02_clean.py` (S11) | region, source, year | all detections, cleaned schema below |
| `data/interim/clean/<REGION>/<SOURCE>/<YEAR>.json` | `02_clean.py` | same | counts for that file (rows read, duplicates dropped, by satellite/confidence/type, versions) |
| `data/interim/filtered/<REGION>/<SOURCE>/<YEAR>.parquet` | `03_filter.py` (S12) | region, source, year | kept detections, same columns as clean |
| `data/interim/reports/clean_summary.csv`, `clean_versions.csv` | `02_clean.py` | — | one row per region-source-year / per version |
| `data/interim/reports/filter_counts.csv`, `filter_summary.csv` | `03_filter.py` | — | removals per region-source-year / per region-sensor |
| `data/interim/validation/` | `03b_sanity_checks.py` (S13) | — | plots and tables; copied into `docs/validation/S13/` |
| `data/interim/grid/daily/<REGION>/<YEAR>.parquet` | `04_dedupe_and_grid.py` (S14) | region, year | in-region detections counted per day, 0.25° cell (`lat_idx`, `lon_idx`) and satellite: `n`, `n_night`, `n_px1km`, `frp_sum` |
| `data/interim/grid/monthly/<REGION>__<SATELLITE>.parquet` | same | region, satellite | the same per month, plus `days_active` |
| `data/interim/grid/region_monthly.csv`, `region_cells.csv` | same | — | region totals per month and satellite; the cells of each region with the share of the cell inside the outline |
| `data/interim/reports/grid_summary.csv` | same | — | rows in / outside the region / gridded, per region, source and year |
| `data/boundaries/regions_ne.geojson` (committed) | `scripts/make_region_boundaries.py` | — | real region outlines from Natural Earth 10m admin-1. AU-NSW-VIC = NSW + Victoria + ACT + Jervis Bay; PT = the 18 mainland districts |
| `data/interim/extract/` | `03c_interim_extract.py` | — | small extract (daily counts, coverage, 200-row samples); copied into the committed folder `data/interim_extract/` |

`<SOURCE>` is one of `MODIS_SP`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_SP`. `<REGION>` is a region id from `pipeline/config.py` (`US-CA`, `BR-PA`, `AU-NSW-VIC`, `PT`). `<YEAR>` is the UTC year of `acq_date`.

## Cleaned schema (clean and filtered parquet files)

Fixed column order and types (`pipeline/common.py`, `CLEAN_COLUMNS`). MODIS and VIIRS use the same columns.

| Column | Type | Meaning |
|---|---|---|
| `region_id` | string | Region of the download box |
| `source` | string | FIRMS source, e.g. `VIIRS_NOAA20_SP` |
| `sensor` | string | `MODIS` or `VIIRS` |
| `satellite` | string | `T`, `A` (MODIS `Terra`/`Aqua` mapped), `N`, `N20`, `N21` |
| `date` | string | `YYYY-MM-DD`, FIRMS `acq_date` (UTC) |
| `time_utc` | string | `HHMM`, zero-padded (FIRMS writes `250` for 02:50) |
| `latitude`, `longitude` | float64 | Pixel centre |
| `confidence` | string | `low`, `nominal`, `high` (MODIS: < 30, 30–79, ≥ 80; VIIRS `l`/`n`/`h`) |
| `confidence_raw` | string | FIRMS value as given (`0`–`100` or `l`/`n`/`h`) |
| `type` | int8 | 0 vegetation fire, 1 volcano, 2 static land source, 3 offshore |
| `frp` | float64 | Fire radiative power, MW |
| `daynight` | string | `D` or `N` |
| `brightness` | float64 | MODIS `brightness` / VIIRS `bright_ti4` (K) |
| `bright_bg` | float64 | MODIS `bright_t31` / VIIRS `bright_ti5` (K) |
| `scan`, `track` | float64 | Pixel size (km) |
| `version` | string | FIRMS collection version (`6.03`, `61.03`, `2`) |

Rows are sorted by `date`, `time_utc`, `satellite`, `latitude`, `longitude`.

## Rules that prevent double counting

1. **Year files by row date.** A raw chunk that spans New Year is read for both years, but each row goes only into the year of its own `acq_date`.
2. **Exact duplicates are dropped** in step 02, and their number is reported (`duplicates_dropped`). Expected only for US-CA 2023, where the S09 test chunks overlap the full download. Any other region with duplicates should be looked at.
3. **Outputs are overwritten, never appended.** Re-running a step gives the same files.
4. **Checks that must hold:**
   - step 02, per region and source: raw rows = rows read = kept + duplicates dropped (it prints `[OK]` or `[CHECK]`)
   - step 03, per file: rows in = removed for type + removed for low confidence + kept (each removed row is counted once, under the first rule it fails)
5. **Grid step (S14):**
   - Each in-region detection is counted in exactly one day, cell and satellite row. The script stops unless rows in = rows outside the region + sum of `n`.
   - `cell_id` is `"<lat_idx>_<lon_idx>"` with `lat_idx = floor((lat + 90) / 0.25)` and `lon_idx = floor((lon + 180) / 0.25)`.
   - `n_px1km` counts distinct 0.01° (about 1 km) boxes per day, satellite and day/night half. It is the de-duplicated count: several pixels of one satellite in one MODIS-sized box count once.
   - A point is in the region when the centre of its 0.01° box is inside the outline (about 1 km precision at borders).
   - Detections of the same fire by **different** satellites stay separate rows on purpose; harmonization (S15) decides how to combine satellites.
6. **Not handled yet (later steps):**
   - The same fire seen by several satellites, or by neighbouring pixels in one pass, is not merged here. That is S14 (grid and dedupe) and the harmonization (S15).
   - Rows are still in the rectangular download box; clipping to the real region boundary is still to do.

## Filter defaults

`pipeline/config.py`: `FILTER_TYPES_KEPT = (0,)`, `FILTER_MIN_CONFIDENCE = "nominal"`. These match the data contract's `metadata.filters` example (`{"min_confidence": "nominal", "types_kept": [0]}`). Change them with the `--types` and `--min-confidence` options of `03_filter.py` for experiments; record any change in `docs/HANDOFF.md`.
