# Handoff log

One entry per shift or step, **newest first**. Shrihan and Yash (and Claude and Codex) work at different times, so this file is how the next person continues without asking anyone. Read the newest entry before you start; write a new one before you stop. Rules: README Section 11.

Status is one of `STARTED`, `DONE`, `PAUSED`, `BLOCKED`. When you finish or pause a step, change your own `STARTED` entry in place instead of adding a second one.

## Template (copy this to the top of the entries below)

```
### <date> — <step id and name> — <STATUS>
- **Who / AI:** <Shrihan or Yash> using <Claude or Codex>
- **Did:** <2–5 plain sentences: what is now true that was not true before>
- **Files changed:** <paths>
- **How to check it:** <exact commands to run and what you should see>
- **Results / numbers:** <counts, metrics, plot file names; say "none" if none>
- **Decisions and why:** <what you chose, what you rejected, why>
- **Problems / open questions:** <anything broken, unclear, or needing the other person>
- **Next step:** <step id and what to do first>
- **If PAUSED — branch and resume command:** <branch name; command to continue>
```

Rules for entries:
- Say only what you verified. Write "not tested" if you did not test it.
- Never paste secrets (the FIRMS key) here.
- If you found a mistake in the previous entry, write it first under "Problems".

## Entries

### 2026-11-14 — S10 Download everything — PAUSED (California MODIS done; VIIRS in progress)
- **Who / AI:** Shrihan ran Colab; Claude fixed the downloader twice
- **Did:** (1) First run stopped at 2007-09-01 with "Exceeding allowed transaction limit" → downloader now waits 11 min and retries (merged, PR 16). (2) Next run with that fix finished **MODIS_SP for US-CA: 1,887 chunks, 368,690 rows**, then stopped in VIIRS_SNPP_SP at the chunk starting 2013-07-23 with "Invalid MAP_KEY." after ~2,000 successful requests. FIRMS uses that message for an exhausted limit too, so the downloader now treats "Invalid MAP_KEY" after earlier successes as a limit (wait + retry); before any success it waits once, then stops.
- **Files changed:** `pipeline/01_download.py`, `tests/test_download.py`, `docs/data-notes.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `24 passed`.
- **Results / numbers:** MODIS values recorded in `docs/data-notes.md` §8: `satellite` is `Terra`/`Aqua` (must map to `T`/`A`), `confidence` 0–100, `version` mixes `6.03` and `61.03`, `type` mostly 0.
- **Decisions and why:** treat the ambiguous "Invalid MAP_KEY" as a limit only after the key has been shown to work in the same run.
- **Problems / open questions:** FIRMS limits slow the download; real time per region unknown. 2023 test files overlap full-range chunks → S11 must drop exact duplicate rows. MODIS C6/C6.1 switch date unknown.
- **Next step:** merge `fix/invalid-key-mid-run`, upload a fresh `repo.zip`, rerun US-CA with the same `STEP_ARGS` (MODIS is skipped; VIIRS resumes), then BR-PA, AU-NSW-VIC, PT.
- **If PAUSED — branch and resume command:** branch `fix/invalid-key-mid-run`; Colab step 01 with `--check-availability --region US-CA --start 2000-11-01 --end 2026-08-31`.

### 2026-11-14 — S09 Download one region-year — DONE
- **Who / AI:** Shrihan ran the Colab notebook (step 01) with his key; Claude recorded results and updated code.
- **Did:** Real FIRMS download worked for California 2023. Recorded the data availability table, exact CSV headers and row counts in `docs/data-notes.md` §8. Downloader now reads source dates from `data/raw/data_availability.csv` and prints a value summary (satellite, instrument, confidence, version, daynight, type) per source. NOAA-21 fallback start changed to 2023-03-01 (FIRMS availability).
- **Files changed:** `pipeline/01_download.py`, `pipeline/config.py`, `tests/test_download.py`, `docs/data-notes.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `19 passed`. In Colab, the raw files are in `My Drive/nasa-fire-calendar/raw/<SOURCE>/US-CA/` (73 files each for MODIS_SP, VIIRS_SNPP_SP, VIIRS_NOAA20_SP).
- **Results / numbers:** Colab output: `MODIS_SP: 73 chunks, 8438 rows`; `VIIRS_SNPP_SP: 73 chunks, 38691 rows`; `VIIRS_NOAA20_SP: 73 chunks, 39541 rows`; NOAA-21 skipped (old fallback date). SP data ends 2026-08-31 (MODIS) and 2026-07-31 (VIIRS).
- **Decisions and why:** Use FIRMS's own availability dates over the FAQ dates, because they describe what the API actually serves. Whether NOAA-21 data before 2024-01-17 is used in harmonization is left for S15.
- **Problems / open questions:** Values inside `confidence` etc. not seen yet (summary prints on next run). The newest ~3 months are not in SP data: the calendar must label them (decide in S17/S21). The Colab copy of the code is the `repo.zip` in Drive: **upload a fresh zip after every code change**, or Colab runs old code.
- **Next step:** S10 download everything. In Colab: fresh `repo.zip`, then `STEPS = ["01"]` and `STEP_ARGS = {"01": "--check-availability --region US-CA --start 2000-11-01 --end 2026-08-31"}`; repeat for `BR-PA`, `AU-NSW-VIC`, `PT`. Paste the summaries.

### 2026-11-14 — S08 Fake sample data — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Wrote `scripts/make_sample_fixtures.py`, which creates FAKE files in `web/fixtures/` exactly following `docs/data-contract.md`: 1 region (`US-CA`, rectangle boundary), 3 years (2023-01-01 to 2025-12-31), 3,354 invented detections, then daily/monthly/baseline built from those detections so all files agree. Wrote `scripts/validate_data.py` (schemas + cross-file checks) and `tests/test_contract.py`. Added `requirements.txt`.
- **Files changed:** `scripts/`, `tests/`, `web/fixtures/`, `requirements.txt`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** `pip install -r requirements.txt`; `python3 scripts/validate_data.py web/fixtures` prints `0 problem(s)`; `python3 -m pytest -q tests` prints `7 passed`. Re-running the generator gives identical files (fixed random seed).
- **Results / numbers:** All 7 tests pass. Built-in edge cases: Feb 2023 = observed with zero fires (0, not null); June 2024 = invented outage (all null, `n_days_observed` 0, listed in `known_gaps`); June baseline has only 2 years so its values are null; NOAA-21 appears from its real start date 2024-01-17 (listed as a sensor transition).
- **Decisions and why:** Fake harmonization weights (MODIS 1.0, VIIRS 0.25) and band (±10%) are invented only so files are consistent; they mean nothing. The validator checks things JSON Schema cannot: months with no gaps, daily sums = monthly totals, hotspot rows = monthly raw counts, sum of `harmonized_weight` = `count_harm`. The same validator must be run on real `data/processed/` output in S17.
- **Problems / open questions:** Yash has still not reviewed the data contract (S07). Fixtures use a rectangle, not a real California boundary. `daily.json` is pretty-printed (one value per line); fine for fixtures, real output can be compact.
- **Next step:** S09 (download one region-year, confirm the open items in `docs/data-notes.md` §8) and/or S19 (website scaffold on these fixtures).

### 2026-11-14 — S07 Write the data contract — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Wrote `docs/data-contract.md`: file layout under `data/processed/`, field-by-field tables (type, meaning, example) for `metadata.json`, `regions.geojson`, `regions/<id>/monthly.json`, `daily.json`, `baseline.json`, `hotspots/<year>.csv`, and the pipeline-only `daily_grid.parquet`, plus a table mapping each website feature to the file it reads. Added JSON Schemas in `docs/schemas/`. Added `docs/sources.md` listing every source used with FIRMS (documentation, boundaries, burned area, basemap) with status and licence notes.
- **Files changed:** `docs/data-contract.md`, `docs/schemas/*.schema.json`, `docs/sources.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** `pip install jsonschema`, then in Python load each `docs/schemas/*.schema.json` and run `jsonschema.Draft202012Validator.check_schema(schema)` (all pass). Test documents were checked: a valid month passes; a null `count_harm` with a numeric band fails; an unknown satellite code fails; a baseline with 11 months fails.
- **Results / numbers:** 5 JSON Schemas + 1 CSV column spec. No real data yet.
- **Decisions and why:** (1) `null` = no data, `0` = observed with no fires, enforced by the schema. (2) Daily data stored column-wise to keep files small. (3) Region ids: `US-CA`, `BR-PA`, `AU-NSW-VIC`, `PT`. (4) Website reads per-region files, so it can be a static site. (5) Drawn polygons use hotspot points, not pre-computed months. (6) Boundaries: Natural Earth planned; GADM rejected because its licence forbids redistribution without permission.
- **Problems / open questions:** Yash has **not** reviewed the contract yet; README says contract changes need both people, so Yash should review before S08 is built on it. Open items are in `docs/data-contract.md` §10 (compression, interval width, `count_low`/`count_high` naming). Natural Earth admin-1 licence wording not read on the official page.
- **Next step:** Yash reviews `docs/data-contract.md`. Then S08 (fake fixtures in `web/fixtures/` + a validator script using `docs/schemas/`).

### 2026-11-14 — S05 Verify FIRMS facts, S06 Fix the README — DONE
- **Who / AI:** Shrihan using Claude (plus web search and direct downloads of official NASA pages)
- **Did:** Read the FIRMS FAQ, the attributes page, the FIRMS API area and data-availability pages, and the official MODIS C6/C6.1 and VIIRS C2 user guides. Wrote `docs/data-notes.md` with every fact linked to its source. Corrected README Sections 0, 1, 2.1, 2.2, 2.3, 7, 10 (S03, S09), 13 and the rule lines in `CLAUDE.md` / `AGENTS.md`.
- **Files changed:** `docs/data-notes.md` (new), `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** open `docs/data-notes.md`; each fact has a source tag that maps to a URL at the top. Spot-check: the FIRMS FAQ section "For what dates are the fire data available?".
- **Results / numbers:** Terra from 1 Nov 2000; Aqua from July 2002; S-NPP 20 Jan 2012 to 2 Nov 2026 (**ended**); NOAA-20 from 1 Apr 2018; NOAA-21 from 17 Jan 2024. Area API: max 5 days per call, 5000 transactions per 10 min. MODIS confidence classes: low < 30, nominal 30–79, high ≥ 80.
- **Decisions and why:** (1) Calibration training years changed from 2012–2018 to **2014–2018**, because the FIRMS FAQ says early VIIRS data (first 18–24 months) had many bad scans. (2) Added a check of NOAA-20 vs S-NPP vs NOAA-21, because S-NPP has ended. (3) The session network was changed (new personal environment `nasa-space-apps-yash-and-shrihan` allowing `firms.modaps.eosdis.nasa.gov`, `www.earthdata.nasa.gov`, `earthdata.nasa.gov`) so official pages could be read.
- **Problems / open questions:** See `docs/data-notes.md` §8: exact `_SP` CSV headers and `confidence` letters, `type` presence in VIIRS `_SP`, exact `_SP` date ranges, direct MAP_KEY URL, Terra/Aqua future status and orbit drift, LANCE Disclaimer. All need a real key and are part of S09.
- **Next step:** S07 (write the data contract) and, in parallel by whoever is next, S09 (download one region-year, confirm the open items).

### 2026-11-14 — S04 Pilot regions agreed — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Shrihan reported that Shrihan and Yash agreed on the default pilot regions. Wrote them in README Section 2.1 and ticked S04. Added a "set up your own FIRMS key" section to `AGENTS.md` for Yash.
- **Files changed:** `README.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** README Section 2.1 lists the 4 regions; Section 10 shows S04 ticked.
- **Results / numbers:** Regions: California (USA), Pará (Brazil), New South Wales + Victoria (Australia), Portugal.
- **Decisions and why:** Defaults kept; region boundaries (which admin boundary file) are decided later in the pipeline steps.
- **Problems / open questions:** Yash has not yet confirmed his own FIRMS key setup.
- **Next step:** S05 (verify FIRMS facts).

### 2026-11-14 — S03 FIRMS key; Colab private-repo fix — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Shrihan has a FIRMS key and reports adding it to Colab Secrets as `FIRMS_MAP_KEY` with notebook access on (not verified by the AI). An earlier commit (`c2dd4b5`) had put `.env` with the key on `main`; this change removes `.env` from the repo again (the AI never read its contents). Changed `notebooks/run_pipeline_colab.ipynb` cell 3 to unzip the repo from `My Drive/nasa-fire-calendar/repo.zip` instead of `git clone`, because the repo is private. Ticked S03 in README Section 10.
- **Files changed:** `.env` (deleted), `notebooks/run_pipeline_colab.ipynb`, `README.md`, `docs/HANDOFF.md`
- **How to check it:** `git ls-files | grep -x .env` prints nothing on this branch; in Python, `json.load` the notebook and `ast.parse` each code cell (all parse). Running the notebook in Colab has **not** been done.
- **Results / numbers:** none. The key has not been tested against FIRMS; the new Colab cell has not been run.
- **Decisions and why:** Key kept only in Colab Secrets and in each person's untracked local `.env`. Zip-from-Drive was chosen over a GitHub token in Colab, so no GitHub credential is needed there. Rejected: read-only token (more setup).
- **Problems / open questions:** (1) The key is still visible in git history (commit `c2dd4b5`) to anyone with repo access; it is a free key, but request a new one if the repo goes public. (2) Anyone running locally must create their own untracked `.env` from `.env.example`. (3) The zip must be re-uploaded whenever code changes. (4) The pipeline scripts do not exist yet, so cell 6 onward is untested.
- **Next step:** S04 (pilot regions) and S05 (verify FIRMS facts).

### 2026-11-14 — S01 Read the plan, S02 Tools installed — DONE
- **Who / AI:** Shrihan using Claude (running in the cloud session, not on a personal laptop)
- **Did:** Read `README.md`, `CLAUDE.md` and `docs/HANDOFF.md`. Plan in one sentence: build a harmonized MODIS + VIIRS fire-hotspot history (2000 to now) and a website with a region/date picker, a burning-activity calendar, analytics and CSV download. Checked tool versions in the cloud session's environment and ticked S01 and S02.
- **Files changed:** `README.md` (ticked S01, S02), `docs/HANDOFF.md`
- **How to check it:** run `python3 --version && node --version && git --version`. Expected on the cloud session: Python 3.13.18, Node v22.23.4, git 2.43.0 (also npm 10.9.9, and `python3.11` and `python3.12` exist).
- **Results / numbers:** Python 3.13.18 (needs 3.11+: ok), Node v22.23.4 (needs 20+: ok).
- **Decisions and why:** These versions are for the **cloud session only**. They say nothing about Shrihan's or Yash's own computers, or about Colab. Each person should run the same two commands wherever they will work and add the result under their own entry. Not verified: Colab's Node.js version (the notebook only needs Python).
- **Problems / open questions:** None for S01/S02. S03 (FIRMS key) can only be done by a person. S04 (pilot regions) needs a decision from the two of you.
- **Next step:** S05 (verify FIRMS facts) needs only web research and can be done without S03/S04. S03 and S04 are for a person.

### 2026-11-14 — Colab runner notebook — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Added `notebooks/run_pipeline_colab.ipynb`, which clones the repo in Colab, installs packages, reads the FIRMS key from Colab Secrets, keeps raw and interim data on Google Drive, runs chosen pipeline scripts and tests, and prints a summary for the handoff. Added README Section 14 and a Colab note in `CLAUDE.md` and `AGENTS.md`.
- **Files changed:** `notebooks/run_pipeline_colab.ipynb`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** in Python, `json.load` the notebook and `ast.parse` each code cell (this was done: all 9 cells parse). To run it for real, follow README Section 14.1 and run with `STEPS = []`; expect "nothing to run".
- **Results / numbers:** none. The notebook has **not been run in Colab**, because no tool here can open Colab. The `pipeline/` scripts do not exist yet, so the run cells are untested.
- **Decisions and why:** Data stays on Drive and is not committed; no GitHub token goes into Colab, so results come back through handoff entries and manual downloads.
- **Problems / open questions:** Script command-line arguments are not defined yet; the notebook runs each script with no arguments. When S09 is written, update the notebook cell 6 to pass the region and year.
- **Next step:** S01, S05 as before; the first person to open the notebook in Colab should run it with `STEPS = []` and note whether setup worked.

### 2026-11-14 — Planning docs — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** Wrote the project plan in `README.md`, `CLAUDE.md`, `AGENTS.md`, and the step-by-step checklist (Section 10) with this handoff log. No code exists yet.
- **Files changed:** `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `docs/HANDOFF.md`
- **How to check it:** open `README.md` on GitHub and confirm Sections 0–13 render; the checklist boxes in Section 10 are all unticked.
- **Results / numbers:** none
- **Decisions and why:** Work is one-person-at-a-time with a single ordered checklist, because the two people work at different times. Sensor dates and FIRMS column names in the README are from memory and unverified until step S05.
- **Problems / open questions:** The FIRMS key-request link and sensor start dates are unverified. Pilot regions are a suggestion until S04.
- **Next step:** S01 (read the plan), then S05 (verify FIRMS facts).
