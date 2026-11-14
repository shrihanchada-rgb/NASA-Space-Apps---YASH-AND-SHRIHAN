# AGENTS.md

Guidance for Codex in this repository. `CLAUDE.md` holds the matching rules for Claude Code; if you change shared project rules here, update `CLAUDE.md` too.

## Roles

Shrihan leads the backend data work (`pipeline/`, `data/`, `docs/data-notes.md`, `docs/validation/`). Yash leads the website (`web/`, `web/fixtures/`, `docs/data-contract.md`). You are not tied to either: do whatever task the person assigns, in any folder. Claude Code (reads `CLAUDE.md`) is used the same way. If a task touches the other person's half, mention it in the pull request. Role table: README Section 9.

## Status

Planning stage. No source code, build system, linter, or tests exist yet, so there are no commands to document. When you scaffold `pipeline/` or `web/`, add its real commands here (install, run, test, single test such as `pytest pipeline/tests -k <name>`).

`README.md` is the source of truth for scope, task order, and ownership. Read it fully before starting. Do not create a competing plan elsewhere; edit the README instead.

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

## Yash: set up your own FIRMS key (once, before any download step)

Shrihan's key is not in the repo. Before running anything that downloads FIRMS data (step S09 onward), Yash must:
1. Request a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ (use the "Get MAP_KEY" link on https://firms.modaps.eosdis.nasa.gov/api/area/).
2. Colab: add it in Colab Secrets (key icon in the left sidebar), name `FIRMS_MAP_KEY`, with "Notebook access" on.
3. Laptop: `cp .env.example .env`, open `.env`, write `FIRMS_MAP_KEY=<key>`, save. Check `git check-ignore -v .env` prints a line. Never commit `.env`.
4. Never paste the key into chat, a notebook cell, or `docs/HANDOFF.md`.

If you are Codex and Yash has not confirmed this, remind him before any download step.

## Rules

- Never invent data. Sample fixtures must be marked `"is_sample": true`. If real data is missing, stop and say so.
- Every harmonized value ships with `count_raw`, `count_harmonized`, `method_version`, and an uncertainty band.
- Use FIRMS standard-processing (SP) archive data for history; near-real-time data is only for the "current fire" feature, labeled provisional.
- Use the verified facts in `docs/data-notes.md` (sensor dates, API limits, columns, confidence, `type`, citation). Items in its "Still unverified" section must be checked on the first real download (S09) before code depends on them. S-NPP ended on 2 Nov 2026.
- Changing the data contract needs both people's agreement; flag it rather than changing it alone.
- Tests must not download data. `.env` (FIRMS MAP_KEY) and `data/raw/` are gitignored; never put secrets in website code.
