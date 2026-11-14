# AGENTS.md

Guidance for Codex in this repository. `CLAUDE.md` holds the matching rules for Claude Code; if you change shared project rules here, update `CLAUDE.md` too.

## Who you are working for

You are Yash's AI. Yash owns the frontend website: `web/`, the data contract fixtures (`web/fixtures/`, `docs/data-contract.md`), and keeping the README checklist current. Shrihan owns the backend data work (`pipeline/`, `data/`) and works with Claude. Do not edit `pipeline/` or `data/`; if a change is needed there, say so and stop. Full role table: README Section 9.

## Status

Planning stage. No source code, build system, linter, or tests exist yet, so there are no commands to document. When you scaffold `web/`, add its real commands here (dev server, build, test, single test).

`README.md` is the source of truth for scope, task order, and ownership. Read it fully before starting. Do not create a competing plan elsewhere; edit the README instead.

## Start of every session

1. `git checkout main && git pull`, then branch as `task/<id>-<short-name>` (README Section 11.2).
2. Find the task in the README checklist (Section 10) and check `docs/CLAIMS.md` that nobody else has it. Add a claim line.
3. When done: tick the checklist box in the same pull request, set the claim to `in review`, and show Yash the commands you ran and their output. Never push to `main`; Shrihan reviews before merge.

## Project

Harmonized MODIS + VIIRS active-fire hotspot series (about 2000 to present) plus a web app showing a burning-activity calendar for a chosen region and date range, with analytics and CSV export.

- **Pipeline (Shrihan):** `pipeline/01_download` to `07_validate` turn raw FIRMS CSVs into the app files in `data/processed/`. MODIS-equivalent counts are the reference scale; the conversion is learned on the 2012+ overlap.
- **Web app (yours):** reads only the files defined in the data contract (README Section 11.3, `docs/data-contract.md`). Until the pipeline delivers, build against `web/fixtures/`. Switching to `data/processed/` must need no app changes; if it does, the contract was broken, so fix the contract or pipeline, not the app.
- **Calendar:** years x months heatmap; log-count, percentile, and anomaly color modes; `count_harm: null` means missing data and is hatched, never shown as zero.

## Rules

- Never invent data. Sample fixtures must be marked `"is_sample": true`. If real data is missing, stop and say so.
- Every harmonized value shown comes with its uncertainty (`count_low`/`count_high`) and `method_version`.
- Near-real-time FIRMS data is only for the "current fire" feature and is labeled provisional.
- Sensor dates, FIRMS column names, and confidence mapping are unverified until `docs/data-notes.md` (Task 1.1) exists. Do not hard-code them before then.
- Changing the data contract needs Shrihan's agreement; flag it rather than changing it alone.
- `.env` (FIRMS MAP_KEY) and `data/raw/` are gitignored; never put secrets in the website code.
