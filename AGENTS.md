# AGENTS.md

Guidance for Codex and other AI coding agents working in this repository. `CLAUDE.md` carries the same project rules for Claude Code; if you change one, update the other.

## Status

Planning stage. The repo holds only `README.md` (the project plan), `CLAUDE.md`, `AGENTS.md`, and `.gitignore`. There is no source code, build system, linter, or test suite yet, so there are no build or test commands. When you scaffold the pipeline or web app, add the real commands to this file and to `CLAUDE.md`.

`README.md` is the source of truth for scope, task order, and ownership. Read it fully before starting. Do not create a competing plan elsewhere; edit the README instead.

## Project

NASA Space Apps challenge: a harmonized MODIS + VIIRS active-fire hotspot time series (about 2000 to present) and a web app that shows a burning-activity calendar for a chosen region and date range, with analytics and CSV export.

1. **Pipeline (`pipeline/`, Python):** numbered scripts `01_download` to `07_validate` turn raw NASA FIRMS archive CSVs into app-ready files in `data/processed/`. The core step is `05_calibrate`: MODIS-equivalent counts are the reference scale, and a mapping learned on the 2012+ overlap is applied to VIIRS-era data. Compare the candidate methods in the README by held-out validation and document the winner.
2. **Web app (`web/`):** reads only the pre-aggregated outputs, never raw files. The centerpiece is a years x months calendar heatmap with log-count, percentile, and anomaly color modes. Missing data is hatched, never shown as zero.

Data flows one way: raw FIRMS -> pipeline -> `data/processed/` -> web.

## Rules

- Use FIRMS standard-processing (SP) archive data for history. Near-real-time data is only for the "current fire" feature and must be labeled provisional.
- Every harmonized value ships with `count_raw`, `count_harmonized`, `method_version`, and an uncertainty band.
- Sensor start dates, FIRMS column names, and the MODIS confidence mapping in the README are unverified (written from memory). Do not hard-code them until Task 1.1 (`docs/data-notes.md`) confirms them.
- The FIRMS MAP_KEY goes in `.env` (gitignored). `data/raw/` is gitignored; do not commit raw downloads or secrets.

## Coordinating with other agents and people

- Pick an unblocked task from the README work breakdown (Section 6) and add a line for it to `docs/CLAIMS.md` before starting.
- One branch per task. Do not push to `main` directly; open a pull request.
- Do not take a task already claimed in `docs/CLAIMS.md`.
