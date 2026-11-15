# Interim data extract (small, committed)

This folder holds a small summary of the interim data in the repo, so anyone, and any AI (Claude or Codex), can work with the real cleaned and filtered data without Google Drive.

The **full interim data** is 18,888,356 cleaned detections, as parquet files. It is too big for git and lives on Shrihan's Google Drive:

| What | Drive path (Colab path) | Shape |
|---|---|---|
| Cleaned detections (all types and confidences) | `My Drive/nasa-fire-calendar/interim/clean/<REGION>/<SOURCE>/<YEAR>.parquet` (`data/interim/clean/...`) | one row per detection; columns in `docs/pipeline-files.md` |
| Filtered detections (type 0, confidence ≥ nominal) | `.../interim/filtered/<REGION>/<SOURCE>/<YEAR>.parquet` | same columns |
| Reports | `.../interim/reports/*.csv` | copied to `docs/validation/S13/` |
| This extract (source) | `.../interim/extract/` | copied here |

## Files in this folder

| File | What it is | Made by |
|---|---|---|
| `daily_counts.csv` | One row per region, source, satellite and UTC day with at least one cleaned detection. Columns: `region_id, date, source, sensor, satellite, n_clean, n_kept, n_kept_high, n_kept_night, frp_sum_kept` | `pipeline/03c_interim_extract.py` |
| `coverage.csv` | Per region and source: first and last day downloaded, days downloaded, days missing | same |
| `samples/<REGION>__<SOURCE>.csv` | 200 real filtered detections per region and source (fixed random sample), with the full cleaned columns | same |
| `MANIFEST.json` | Build time, totals, filter used | same |

**Status:** filled once `03c` has run in Colab and the output has been copied here. If `daily_counts.csv` is missing, this has not happened yet; see "How to refresh".

Monthly and yearly tables already exist in `docs/validation/S13/` (`monthly_counts.csv`, `yearly_counts.csv`, `filter_counts.csv`, `clean_summary.csv`, `clean_versions.csv`, `gaps.csv`).

## How to read it correctly

- **No row does not always mean no data.**
  - A day inside `coverage.csv`'s downloaded range with no row in `daily_counts.csv` means **observed, 0 detections**.
  - A day outside the downloaded range means **no data**.
  - Exception: PT MODIS for Dec 2025 – Jan 2026 is probably a FIRMS archive gap, so treat it as no data (`docs/validation/S13/README.md`).
- **The counts are raw detections inside the rectangular download boxes** in `pipeline/config.py`. They are not clipped to region borders and not harmonized.
- **Compare MODIS with a single VIIRS satellite, not the VIIRS sum.** The number of VIIRS satellites changes in 2018 and 2023.
- **Treat Terra (`T`) and Aqua (`A`) separately.** Their ratio depends on region and season.
- **Partial periods:**
  - MODIS starts 2000-11-01; Aqua starts 2002-07-04.
  - S-NPP starts 2012-01-20, NOAA-20 2018-04-01, NOAA-21 2023-03-01.
  - The data ends 2026-08-31 (MODIS) and 2026-07-31 (VIIRS).

## How to refresh

1. Upload a fresh `repo.zip` of `main` to Drive (README Section 14).
2. In Colab, set `STEPS = ["03c"]` and `STEP_ARGS = {}`, then Run all. It needs the clean and filtered files on Drive, which steps 02 and 03 made.
3. Copy `My Drive/nasa-fire-calendar/interim/extract/` into this folder, or ask Claude to copy it with the Drive connector. Commit, and note it in `docs/HANDOFF.md`.
