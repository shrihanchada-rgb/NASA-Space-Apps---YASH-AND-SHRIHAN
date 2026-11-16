# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Roles

Shrihan leads the backend data work (`pipeline/`, `data/`, `docs/data-notes.md`, `docs/validation/`). Yash leads the website (`web/`, `web/fixtures/`, `docs/data-contract.md`). You are not tied to either: do whatever task the person assigns, in any folder. Codex (reads `AGENTS.md`) is used the same way. If a task touches the other person's half, mention it in the pull request. Role table: README Section 9.

## Status

The pipeline runs end to end for California: download, clean, filter, grid, harmonize, and the website's real files in `data/processed/` (steps S01–S17). Fake sample files (`web/fixtures/`) remain for tests. The website (`web/`) has region/date selection, totals, a satellite map with area drawing, the burning calendar, charts, CSV downloads, map hotspots, comparison with past years and a Methods page (S19–S28). It runs on the real data by default; deploying (S29) is next.

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
| Clean raw files (S11), all regions or one | `python3 pipeline/02_clean.py` / `--region PT` |
| Filter and count removals (S12) | `python3 pipeline/03_filter.py` |
| Sanity-check plots and tables (S13) | `python3 pipeline/03b_sanity_checks.py` |
| Small committed extract of the interim data (`data/interim_extract/`) | `python3 pipeline/03c_interim_extract.py` |
| Clip to region outlines and grid (S14; needs Drive files, Colab) | `python3 pipeline/04_dedupe_and_grid.py` |
| Fit harmonization methods (S15; runs from the repo) | `python3 pipeline/05_calibrate.py` |
| Score methods, choose, plot (S16) | `python3 pipeline/05b_compare_methods.py` |
| Build the website's files in `data/processed/` (S17; California) | `python3 pipeline/06_aggregate.py` |
| Audit `data/processed/` for double counting and harmonization errors | `python3 pipeline/06b_audit_processed.py` |

The key is read from the `FIRMS_MAP_KEY` environment variable (Colab Secrets) or a local `.env`; it is never printed. Raw files go to `data/raw/<SOURCE>/<region>/` (gitignored). 

Website (run inside `web/`; structure and rules in `web/README.md`):

| What | Command |
|---|---|
| Install (once) | `npm install` |
| Dev server on real data (default) | `npm run dev` |
| Dev server on sample data | `DATA_DIR=fixtures npm run dev` |
| Type check | `npm run typecheck` |
| Unit tests / one file | `npm test` / `npx vitest run src/data/derive.test.ts` |
| Build to `web/dist/` | `npm run build` |

## Design skill

The `ui-ux-pro-max` skill is installed in `.claude/skills/ui-ux-pro-max/` (third-party, MIT, see its `SOURCE.md`). Claude Code loads it automatically for UI work. Its search tool runs offline: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain chart` (domains include `ux`, `style`, `color`, `typography`, `chart`). Its advice is input, not a rule: the data contract and README spec win when they disagree.

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

## Project state and lessons so far (read before any pipeline or Colab work)

Last updated 2026-11-15. Details and sources: `docs/data-notes.md` §8 (numbers), `docs/HANDOFF.md` (what each session did). If these disagree, the newest `docs/HANDOFF.md` entry wins; then fix this section.

**Scope (changed 2026-11-15): California only.** `ACTIVE_REGIONS = ["US-CA"]` in `pipeline/config.py`; scripts default to it. The other three regions are archived (`archive/other_regions/README.md`) and remain in `docs/validation/` as evidence for the method.

**Steps ticked in README Section 10:** S01–S17, S19–S28 (2026-11-16).
- **The website's real data exists: `data/processed/`** (California, contract-valid, `"is_sample": false`). Read `data/processed/README.md` first. The site uses it by default (`cd web && npm run dev`); sample files: `DATA_DIR=fixtures npm run dev`.
- **Harmonization: method A1, `method_version` `A1-1.0`,** policy `blend` (`HARMONIZE_POLICY` in `pipeline/config.py`):
  - from 20 Jan 2012, `count_harm` = half observed MODIS + half k[calendar month] × S-NPP
  - before that, observed MODIS; Terra-only months × 2.056
  - Results and limits: `docs/validation/README.md`. California test scores: R² 0.992, typical error 11.8%.
- **California's filtered files are small** (55 files, 49 MB, each under 10 MB), so Claude Code can fetch them with the Drive connector and run steps 04–06 without Colab. Codex needs the person to copy `interim/filtered/US-CA/` from Drive into `data/interim/filtered/US-CA/`.

**Raw data: where it is and how much.** It is not in the repo. It is in Shrihan's Google Drive at `My Drive/nasa-fire-calendar/raw/<SOURCE>/<REGION>/<YYYY-MM-DD>_<n>d.csv`. Each file is one FIRMS request: 5 days, or fewer at the end of a range. The folder also holds `raw/data_availability.csv`, with FIRMS date ranges per source. In Colab, `data/raw` and `data/interim` are symlinks to that Drive folder. You cannot read Drive. Ask the person to run a counting cell and paste the output.

| Region | MODIS_SP | VIIRS_SNPP_SP | VIIRS_NOAA20_SP | VIIRS_NOAA21_SP | Status |
|---|---|---|---|---|---|
| US-CA | 368,690 | 1,117,337 | 773,314 | 149,284 | done |
| BR-PA | 2,707,098 | 5,348,275 | 2,857,121 | 1,206,395 | done |
| AU-NSW-VIC | 629,515 | 1,817,213 | 1,223,995 | 310,146 | done |
| PT | 102,903 | 158,096 | 78,298 | 40,676 | done |

- **Rows** are counted before cleaning. They cover the download box, which is larger than the real region.
- **A complete download** of one region has 1,887 / 1,062 / 609 / 250 files for MODIS_SP / VIIRS_SNPP_SP / VIIRS_NOAA20_SP / VIIRS_NOAA21_SP. That is the full ranges 2000-11-01 → 2026-08-31 (MODIS) and → 2026-07-31 (VIIRS). A leftover `*.part` file is an unfinished chunk; a rerun replaces it. Exception: the US-CA folders for MODIS_SP, VIIRS_SNPP_SP and VIIRS_NOAA20_SP also hold 73 extra files from the S09 test (`--year 2023`, chunks starting 2023-01-01). Their 5-day windows do not line up with the full run's, so the same detections appear in two files. This is why S11 must drop exact duplicates.

**Facts from the real files that code must follow** (verified; full list in `docs/data-notes.md` §8):
- **MODIS `satellite` is `Terra`/`Aqua` in full words.** Map them to `T`/`A`. VIIRS `satellite` is `N`, `N20`, `N21`.
- **Confidence.** MODIS gives a number from 0 to 100: low < 30, nominal 30–79, high ≥ 80. VIIRS gives lower-case `l`/`n`/`h`. VIIRS SP data does contain `l` rows (4.7–7.0% by region).
- **MODIS `version` mixes `6.03` and `61.03`.** The date where it switches is not known yet; record it in S11.
- **`type`:** 0 vegetation, 1 volcano, 2 static land source, 3 offshore. The type-2 share varies a lot by region: 9–17% of VIIRS rows in US-CA, 0.3–0.5% in BR-PA, 2–3% in AU-NSW-VIC, 1.2% (MODIS) and 4.8–7.8% (VIIRS) in PT.
- **Aqua/Terra row ratio:** about 0.94 in US-CA, 1.84 in BR-PA, 1.86 in AU-NSW-VIC, 1.01 in PT. So the Terra-only period (Nov 2000 – Jun 2002) undercounts by a different amount in each region. S15 must treat Terra and Aqua separately or per region.
- **The download boxes in `pipeline/config.py` are approximate rectangles.** They also cover neighbouring states and sea: AU-NSW-VIC includes strips of Queensland and South Australia; PT includes a strip of western Spain. Clip to real boundaries (Natural Earth; GADM is rejected for licence reasons, see `docs/sources.md`).
- **BR-PA alone is 12.1 million rows.** S11 and later steps must read files in chunks or per source and year, not all at once. Colab memory has not been measured.

**FIRMS API behaviour learned the hard way:**
- **The limit is per key.** It is 5,000 transactions per 10 minutes. Every run using the same key at the same time shares it. `01_download.py` stays under 3,000 per 10 minutes using the FIRMS cost formula, but FIRMS's own count has been higher than that formula.
- **Two messages mean the limit is used up.** One is "Exceeding allowed transaction limit". The other is **"Invalid MAP_KEY."** — FIRMS sends it for a used-up limit too, not only for a wrong key. The downloader waits 11 minutes and retries, up to 12 times. "Invalid MAP_KEY." before any success in a run gets one wait, then stops, because the key is probably wrong.
- **Waits do not lose data.** Rerunning resumes, because finished files are skipped.
- **PT run, 2026-11-15:** 4 FIRMS limit waits (about every 500 MODIS chunks, then once in VIIRS_SNPP_SP); earlier regions had none. Cause not verified. A first PT attempt, on two devices, probably used the key at the same time. Advice: keep one session (Runtime → Manage sessions). If waits keep happening with one session in later downloads, lower `TRANSACTION_BUDGET` in `pipeline/config.py`. Don't spread the work over several keys to get around the limit.
- **Drive must be connected before downloading.** In the first PT attempt, Drive was not mounted, so the notebook created `/content/drive/MyDrive/...` on Colab's temporary disk and the files went there (lost). The next mount then failed with `ValueError` ("Mountpoint must not already contain files"). Fix: Runtime → Disconnect and delete runtime, then Run all. Never tell the person to `rm -rf /content/drive` (if Drive is mounted it deletes their real files).

**Colab workflow facts (the person runs it; you cannot):**
- **The repo is private, so Colab gets the code from `My Drive/nasa-fire-calendar/repo.zip`.** That is a GitHub "Download ZIP" of `main`. When the zip is there, `BRANCH` in the notebook is ignored. **Code changes reach Colab only after the person uploads a fresh zip.** Always tell them when they need one. Changes to docs only do not need one.
- **The person's Colab notebook is a separate copy.** Editing `notebooks/run_pipeline_colab.ipynb` in the repo does not change it; they must re-upload it. Once, a Colab "Save to GitHub" overwrote the repo notebook with an old copy (fixed in PR #14). Check that notebook diffs are intended.
- **They choose the run in the first cell.** `STEPS` and `STEP_ARGS` in cell 1 say what runs, for example `STEPS = ["01"]` and `STEP_ARGS = {"01": "--check-availability --region PT --start 2000-11-01 --end 2026-08-31"}`. The first output line `Region <ID> [bbox]` shows which region really ran.
- **Use one device and one session at a time.** The same notebook open on a laptop and a phone has caused confusion: old outputs, an unintended BR-PA rerun, and probably shared key use. Old cell outputs stay on screen until a cell is re-run.
- **Output streams live.** Ask the person to paste the per-source summary lines: `<SOURCE>: N chunks (M already on disk), R rows` and the value counts under them.

**Key and secrets:**
- **The FIRMS key lives in Colab Secrets** as `FIRMS_MAP_KEY`, or in an untracked local `.env`. Never ask for it in chat.
- **The key is still in git history** (commit `c2dd4b5`, when `.env` was briefly committed). The repo is private. Advice given: request a new key after S10 finishes and replace it in Colab Secrets; no history rewrite.

**Website side:**
- **Status.** S19–S28 done: calendar (3 colour modes), charts, CSV downloads, map hotspots (points or density), compare with past years, Methods page (`web/methods.html`); phone and keyboard checked. Flat style, no gradients (the "no data" hatch is an SVG pattern), IBM Plex Sans/Mono, NASA GIBS basemap. The user asked for no gradients and fonts that don't look AI-generated. Keep that.
- **Default view is the whole region (California).** A drawn area, or one typed in "Enter an area by coordinates", narrows the summary, calendar, charts and downloads to that area. It snaps outward to the 0.25° grid. Rules and definitions: `web/README.md`, "How some numbers are defined".
- **The site runs on the real data by default since S25** (2026-11-16). Hotspots are one file per month (`hotspots/<YYYY-MM>.csv`, contract §7); the app loads only the months it needs. `web/fixtures/` (invented counts, California's real outline) is for tests and `DATA_DIR=fixtures npm run dev`.
- **The area files are part of the contract** (`docs/data-contract.md` §8b, required by `scripts/validate_data.py`). The user decided this; no approval step.
- **GIBS place-name tiles sometimes return HTTP 500,** so place names are off by default.

**Next steps:**
- **Website:** S29 deploy (GitHub Pages). Do not load all hotspot month files at once (131 MB in total): load only the months in the chosen dates.
- **Pipeline:** S18 (one validate command). Optional: NRT data for months after Aug 2026.
- **After every rebuild of `data/processed/`,** run `python3 scripts/validate_data.py data/processed` and `python3 pipeline/06b_audit_processed.py`; both must pass. The audit checks double counting and the harmonization arithmetic.
- **Satellite outages are missing data, not zero fires.** FIRMS files are simply empty on those days. `06_aggregate.py` finds them (`find_outages`) and writes `satellite_outages.csv`. Any new analysis of daily or monthly counts must do the same.
- **Open, to confirm with the user:** the `blend` policy (alternative `modis_first`).
- **Limits to state in the app:** the range is approximate; conversion error grows after 2023; Terra-only months are less certain.
- **Double counting:** follow the rules in `docs/pipeline-files.md`. Same fire seen by several satellites or neighbouring pixels is S14's job, not cleaning's.

## Using the interim data ("use interim data")

When the person says **"use interim data"**, "use the cleaned data", "use the real data", or similar, work from the cleaned and filtered FIRMS detections. Do not use the fake fixtures in `web/fixtures/`, and do not invent numbers. In order:

1. **Start with the committed extract: `data/interim_extract/`.** Read its `README.md` first.
   - `daily_counts.csv`: per region, source, satellite and day.
   - `coverage.csv`: which days were downloaded.
   - `samples/`: 200 real rows per region and source.
   - Monthly and yearly tables, filter counts, gaps and version ranges are in `docs/validation/S13/`.
   - These are enough for most analysis, charts, prototypes and website tests.
2. **If the task needs individual detections** (gridding, maps, harmonization fits), the full files are the parquet files under `data/interim/clean/` and `data/interim/filtered/`.
   - They are only on Google Drive (`My Drive/nasa-fire-calendar/interim/`) and in Colab, where `data/interim` is a link to Drive.
   - Write the code in `pipeline/`, test it on `data/interim_extract/samples/` or synthetic rows, and ask the person to run it in Colab (`STEPS`) and paste the output.
   - Claude Code may also download a few specific parquet files with the Google Drive connector, if it is connected. Codex cannot read Drive.
3. **If `data/interim_extract/daily_counts.csv` does not exist yet,** say so. Ask the person to run `STEPS = ["03c"]` in Colab, then copy `interim/extract/` into the repo.

The schema of every interim file is in `docs/pipeline-files.md` (fixed columns, one parquet file per region, source and year).

**Rules for interpreting it** (from the real-data checks in `docs/validation/S13/README.md`):
- **No-data versus zero.** A missing day inside the downloaded range is an observed 0. Outside the range it is no data. PT MODIS Dec 2025 – Jan 2026 is probably a FIRMS archive gap: treat it as no data (`null`) and list it in `known_gaps`.
- **Counts are raw** and inside rectangular download boxes. They are not clipped and not harmonized.
- **MODIS against VIIRS:**
  - Compare MODIS (Terra + Aqua) with **one VIIRS satellite**. S-NPP ÷ MODIS is steady per region, about 3.1–4.4 (BR-PA), 2.5–3.9 (PT), 3.0–4.7 (US-CA) and 3.7–5.6 (AU-NSW-VIC) in 2013–2025.
  - The VIIRS total ÷ MODIS jumps when NOAA-20 (2018) and NOAA-21 (2023) start. That is a sensor effect, not a fire change.
- **Terra against Aqua:**
  - The ratio depends on region **and** season. AU-NSW-VIC is 1.1–1.3 in summer and 3–4.5 in autumn; BR-PA is about 1.5–3; US-CA and PT are about 1.
  - Autumn planned or agricultural burning is a daytime activity, seen far more by Aqua (13:30) than by Terra (10:30).
  - Terra and Aqua are drifting from their designed orbits and will shut down from late 2026 / early 2027 (NASA).
- **Seasons** (filtered detections): US-CA Jul–Oct (peak Aug); BR-PA Aug–Nov (peak Sep); PT peak Aug, small March peak; AU-NSW-VIC Dec–Jan wildfire season plus an April peak of small daytime burns inside NSW/VIC.
- **Filters:** type 0 and confidence ≥ nominal remove 5.3–14.2% per region and sensor. VIIRS type 2 (static sources) is 9.4% in US-CA and 7.9% in PT, so quiet years lose a larger share.
- **MODIS `version` `6.03`/`61.03`** switches on 2023-01-01, with no visible step in the counts.
- **Biggest years** (not yet confirmed with sources): US-CA 2020/2021/2018; BR-PA (MODIS) 2007/2005/2004, and 2024 is the highest since 2010; AU-NSW-VIC 2019; PT (MODIS) 2005/2003/2017, (VIIRS) 2025.

## Rules

- Never invent data. Sample fixtures must be marked `"is_sample": true`. If real data is missing, stop and say so.
- Every harmonized value ships with raw counts, `count_harm`, its band (`count_low`/`count_high`), and `method_version`, exactly as in `docs/data-contract.md`. Validate output against `docs/schemas/`.
- Use FIRMS standard-processing (SP) archive data for history; near-real-time data is only for the "current fire" feature, labeled provisional.
- Use the verified facts in `docs/data-notes.md` (sensor dates, API limits, columns, confidence, `type`, citation). Items in its "Still unverified" section must be checked before code depends on them. Standard-processing data lags by a few months (SP ended 2026-07-31 / 2026-08-31 when checked on 2026-11-14). S-NPP ended on 2 Nov 2026.
- Changing the data contract needs both people's agreement; flag it rather than changing it alone.
- Tests must not download data. `.env` (FIRMS MAP_KEY) and `data/raw/` are gitignored; never put secrets in website code.
