# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Who you are working for

You are Shrihan's AI. Shrihan owns the backend data work: `pipeline/`, `data/`, `docs/data-notes.md`, and `docs/validation/`. Yash owns the website (`web/`, `web/fixtures/`, `docs/data-contract.md`) and works with Codex, which reads `AGENTS.md`. Do not edit `web/`; if a change is needed there, say so and stop. Full role table: README Section 9.

## Status

Planning stage. No source code, build system, linter, or tests exist yet, so there are no commands to document. When you scaffold `pipeline/`, add its real commands here (install, run the full pipeline, run all tests, run a single test such as `pytest pipeline/tests -k <name>`).

`README.md` is the source of truth for scope, task order, and ownership. Keep it consistent rather than writing the plan elsewhere.

## Start of every session

1. `git checkout main && git pull`, then branch as `task/<id>-<short-name>` (README Section 11.2).
2. Find the task in the README checklist (Section 10) and check `docs/CLAIMS.md` that nobody else has it. Add a claim line.
3. When done: tick the checklist box in the same pull request, set the claim to `in review`, and show Shrihan the commands you ran and their output. Never push to `main`; Yash reviews before merge.

## Project

Harmonized MODIS + VIIRS active-fire hotspot series (about 2000 to present) plus a web app showing a burning-activity calendar for a chosen region and date range, with analytics and CSV export.

- **Pipeline (yours):** numbered scripts `01_download` to `07_validate` turn raw NASA FIRMS archive CSVs into the app files in `data/processed/`. The core step is `05_calibrate`: MODIS-equivalent counts are the reference scale, and a conversion learned on the 2012+ overlap is applied to VIIRS data. Test candidate methods A, B, C fairly (train 2012–2018, test 2019–2023; README Section 13 Step C) and write the winner and its metrics in `docs/validation/README.md`.
- **Output must match the data contract** (README Section 11.3, `docs/data-contract.md`) exactly. The web app reads nothing else. Missing months are `null`, never `0`.

Data flows one way: raw FIRMS -> pipeline -> `data/processed/` -> web.

## Rules

- Never invent data or rows. If a download fails or a column differs from `docs/data-notes.md`, stop and report it.
- Use FIRMS standard-processing (SP) archive data for history. Near-real-time data is only for the "current fire" feature and must be labeled provisional.
- Every harmonized value ships with `count_raw`, `count_harmonized`, `method_version`, and an uncertainty band.
- Sensor start dates, FIRMS column names, and the MODIS confidence mapping in the README are unverified (written from memory). Do not hard-code them until Task 1.1 (`docs/data-notes.md`) confirms them.
- Tests must not download data; use small checked-in sample rows.
- Changing the data contract needs Yash's agreement.
- The FIRMS MAP_KEY goes in `.env` (gitignored). `data/raw/` is gitignored; do not commit raw downloads.
