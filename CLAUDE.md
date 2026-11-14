# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Roles

Shrihan leads the backend data work (`pipeline/`, `data/`, `docs/data-notes.md`, `docs/validation/`). Yash leads the website (`web/`, `web/fixtures/`, `docs/data-contract.md`). You are not tied to either: do whatever task the person assigns, in any folder. Codex (reads `AGENTS.md`) is used the same way. If a task touches the other person's half, mention it in the pull request. Role table: README Section 9.

## Status

Planning stage. No source code, build system, linter, or tests exist yet, so there are no commands to document. When you scaffold `pipeline/` or `web/`, add its real commands here (install, run, test, single test).

`README.md` is the source of truth for scope, task order, and ownership. Keep it consistent rather than writing the plan elsewhere.

## Start of every session

1. `git checkout main && git pull`, then branch as `task/<id>-<short-name>` (README Section 11.2).
2. Take the task the person names from the README checklist (Section 10); check `docs/CLAIMS.md` that nobody else has it and add a claim line.
3. When done: tick the checklist box in the same pull request, set the claim to `in review`, and show the commands you ran and their output. Do not push to `main`; the other person reviews.

## Project

Harmonized MODIS + VIIRS active-fire hotspot series (about 2000 to present) plus a web app showing a burning-activity calendar for a chosen region and date range, with analytics and CSV export.

- **Pipeline:** `pipeline/01_download` to `07_validate` turn raw NASA FIRMS CSVs into the app files in `data/processed/`. MODIS-equivalent counts are the reference scale; the conversion is learned on the 2012+ overlap. Compare candidate methods A, B, C with train 2012–2018 / test 2019–2023 (README Section 13 Step C) and write the winner and its metrics in `docs/validation/README.md`.
- **Web app:** reads only the files defined in the data contract (README Section 11.3, `docs/data-contract.md`). Build against `web/fixtures/` until real data exists; switching to `data/processed/` must need no app changes.
- **Calendar:** years x months heatmap; log-count, percentile, and anomaly color modes; `count_harm: null` means missing data and is hatched, never zero.

Data flows one way: raw FIRMS -> pipeline -> `data/processed/` -> web.

## Rules

- Never invent data. Sample fixtures must be marked `"is_sample": true`. If real data is missing, stop and say so.
- Every harmonized value ships with `count_raw`, `count_harmonized`, `method_version`, and an uncertainty band.
- Use FIRMS standard-processing (SP) archive data for history; near-real-time data is only for the "current fire" feature, labeled provisional.
- Sensor start dates, FIRMS column names, and confidence mapping are unverified until `docs/data-notes.md` (Task 1.1) exists. Do not hard-code them before then.
- Changing the data contract needs both people's agreement; flag it rather than changing it alone.
- Tests must not download data. `.env` (FIRMS MAP_KEY) and `data/raw/` are gitignored; never put secrets in website code.
