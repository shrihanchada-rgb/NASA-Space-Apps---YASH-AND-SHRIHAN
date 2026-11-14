# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Roles

Shrihan leads the backend data work (`pipeline/`, `data/`, `docs/data-notes.md`, `docs/validation/`). Yash leads the website (`web/`, `web/fixtures/`, `docs/data-contract.md`). You are not tied to either: do whatever task the person assigns, in any folder. Codex (reads `AGENTS.md`) is used the same way. If a task touches the other person's half, mention it in the pull request. Role table: README Section 9.

## Status

Early stage. The data contract (`docs/data-contract.md`), its schemas, fake sample files (`web/fixtures/`), a validator, and tests exist. The FIRMS downloader (`pipeline/01_download.py`) works on real data; later pipeline steps and the website app are not written yet.

`README.md` is the source of truth for scope, task order, and ownership. Keep it consistent rather than writing the plan elsewhere.

## Commands

Install (once): `pip install -r requirements.txt`

| What | Command |
|---|---|
| Re-create the fake sample files in `web/fixtures/` | `python3 scripts/make_sample_fixtures.py` |
| Check a data folder against the data contract | `python3 scripts/validate_data.py web/fixtures` (or `data/processed`) |
| Run all tests | `python3 -m pytest -q tests` |
| Run one test | `python3 -m pytest -q tests/test_contract.py -k missing_month` |
| FIRMS date ranges per source (needs key) | `python3 pipeline/01_download.py --check-availability` |
| Download one region-year (needs key, resumable) | `python3 pipeline/01_download.py --region US-CA --year 2023` |
| See what a download would do, no key needed | `python3 pipeline/01_download.py --region US-CA --year 2023 --dry-run` |

The key is read from the `FIRMS_MAP_KEY` environment variable (Colab Secrets) or a local `.env`; it is never printed. Raw files go to `data/raw/<SOURCE>/<region>/` (gitignored). Website (`web/` app) commands are added when it is scaffolded.

## Start of every session

Shrihan and Yash work at different times, so the repo is the only memory. Do this every time:

1. `git checkout main && git pull`.
2. Read the newest entry in `docs/HANDOFF.md`. If it is `PAUSED`, check out the branch it names and continue from its resume command. Run its "How to check it" commands first; if they fail, say so before doing anything else.
3. Take the next unticked step in README Section 10 whose "Needs" are ticked (or the step the person names). Add a `STARTED` entry to `docs/HANDOFF.md`.
4. Work on a branch `step/S<number>-<short-name>`. Commit small and push often so work survives if the session ends.
5. Before you stop: tick the step in README Section 10, write the handoff entry (template at the top of `docs/HANDOFF.md`: what you did, files changed, exact commands to check it, results, decisions and why, problems, next step), and make sure `main` still runs. If the step is unfinished, push the branch and write a `PAUSED` entry with the resume command.
6. Say only what you verified. Show the person the commands you ran and their output.

## Colab

Heavy pipeline runs happen in Google Colab through `notebooks/run_pipeline_colab.ipynb` (README Section 14). You cannot control Colab: write and fix code in `pipeline/`, tell the person which `STEPS` to run, and ask them to paste the Colab output or summary back. Never put the FIRMS key or a GitHub token in a notebook cell.

## Project

Harmonized MODIS + VIIRS active-fire hotspot series (about 2000 to present) plus a web app showing a burning-activity calendar for a chosen region and date range, with analytics and CSV export.

- **Pipeline:** `pipeline/01_download` to `07_validate` turn raw NASA FIRMS CSVs into the app files in `data/processed/`. MODIS-equivalent counts are the reference scale; the conversion is learned on the 2012+ overlap. Compare candidate methods A, B, C with train 2014–2018 / test 2019–2023 (README Section 13 Step C) and write the winner and its metrics in `docs/validation/README.md`.
- **Web app:** reads only the files defined in the data contract (README Section 11.4, `docs/data-contract.md`). Build against `web/fixtures/` until real data exists; switching to `data/processed/` must need no app changes.
- **Calendar:** years x months heatmap; log-count, percentile, and anomaly color modes; `count_harm: null` means missing data and is hatched, never zero.

Data flows one way: raw FIRMS -> pipeline -> `data/processed/` -> web.

## Rules

- Never invent data. Sample fixtures must be marked `"is_sample": true`. If real data is missing, stop and say so.
- Every harmonized value ships with raw counts, `count_harm`, its band (`count_low`/`count_high`), and `method_version`, exactly as in `docs/data-contract.md`. Validate output against `docs/schemas/`.
- Use FIRMS standard-processing (SP) archive data for history; near-real-time data is only for the "current fire" feature, labeled provisional.
- Use the verified facts in `docs/data-notes.md` (sensor dates, API limits, columns, confidence, `type`, citation). Items in its "Still unverified" section must be checked before code depends on them. Standard-processing data lags by a few months (SP ended 2026-07-31 / 2026-08-31 when checked on 2026-11-14). S-NPP ended on 2 Nov 2026.
- Changing the data contract needs both people's agreement; flag it rather than changing it alone.
- Tests must not download data. `.env` (FIRMS MAP_KEY) and `data/raw/` are gitignored; never put secrets in website code.
