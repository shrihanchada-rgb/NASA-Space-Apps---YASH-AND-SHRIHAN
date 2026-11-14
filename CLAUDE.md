# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Planning stage. The repo contains only `README.md` (the project plan) and `.gitignore`. There is no source code, build system, linter, or test suite yet, so there are no build/test commands to document. Add them here when the pipeline and web app are scaffolded.

`README.md` is the source of truth for scope and task ownership. Read it before starting work; it is also shared with Codex AI, so keep it consistent rather than forking the plan elsewhere.

## Project

NASA Space Apps challenge: a harmonized MODIS + VIIRS active-fire hotspot time series (~2000 to present) and a web app that shows a burning-activity calendar for a user-selected region and date range, with analytics and CSV export. Two parts:

1. **Pipeline (`pipeline/`, Python):** numbered scripts `01_download` to `07_validate`, turning raw NASA FIRMS archive CSVs into app-ready files in `data/processed/` (`daily_grid.parquet`, per-region `monthly_region.json`, `regions.geojson`, `anomaly_baseline.json`, `metadata.json`). The core step is `05_calibrate`: MODIS-equivalent counts are the reference scale, and a mapping learned on the 2012+ overlap is applied to VIIRS-era data. Three candidate methods are to be compared by held-out validation, and the winner documented.
2. **Web app (`web/`):** reads only the pre-aggregated outputs, so queries stay fast. Centerpiece is a years x months calendar heatmap (log-count, percentile, and anomaly color modes; missing data hatched, never shown as zero).

The data flows one way: raw FIRMS -> pipeline -> `data/processed/` -> web. The app must not depend on raw files.

## Rules specific to this repo

- Use FIRMS standard-processing (SP) archive data for history. Near-real-time data is only for the "current fire" feature and must be labeled provisional.
- Every harmonized value ships with `count_raw`, `count_harmonized`, `method_version`, and an uncertainty band. Do not publish harmonized numbers without them.
- Facts in the README about sensor start dates, FIRMS column names, and the MODIS confidence mapping came from memory and are unverified until Task 1.1 (`docs/data-notes.md`) confirms them. Do not hard-code them before then.
- The FIRMS MAP_KEY goes in `.env` (gitignored). `data/raw/` is gitignored; do not commit raw downloads.
- Coordination: claim a task as a line in `docs/CLAIMS.md` and work on one branch per task, so Yash, Shrihan, and Codex do not collide.
