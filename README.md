# NASA Space Apps — Harmonized Burning Activity Calendar (MODIS + VIIRS)

> Team: Shrihan and Yash. This README is the single source of truth for what to build, so humans and AI coding agents (e.g. Codex) can work on the same problem without overlap.
> Status: planning. No code yet. Data facts are verified in `docs/data-notes.md` (step S05); items still open are listed at the end of that file.

---

## 0. Context
NASA FIRMS has two active-fire records: MODIS (Terra from 1 Nov 2000, Aqua from July 2002, ~1 km pixels) and VIIRS (S-NPP 20 Jan 2012 to 2 Nov 2026, now ended; NOAA-20 from 1 Apr 2018; NOAA-21 from 17 Jan 2024; ~375 m pixels). VIIRS detects more, smaller fires, so raw counts are not comparable across sensors; a naive concatenation creates a fake jump in 2012. Emergency managers need one consistent hotspot history per place. Goal: harmonize, then expose it via a web app with region + date selection, analytics, a burning-activity calendar (color ramp), and CSV export.

(Dates verified from the FIRMS FAQ on 2026-11-14; sources in `docs/data-notes.md`. S-NPP stopped delivering data on 2 November 2026, so VIIRS continuity now depends on NOAA-20 and NOAA-21.)

## 1. Mission / Goals / Objectives

**Mission:** Make 25 years of satellite fire detections comparable, so users judge fire activity (seasonality, anomalies, current fire vs. history) without caring which sensor saw it.

**Goals**
1. G1 — One consistent hotspot time series, ~2000–present, sensor-agnostic.
2. G2 — A web app where a user picks a region and date range and gets analytics, charts, a calendar, and a CSV.
3. G3 — Transparency: every harmonized number traceable to method + uncertainty.

**Measurable objectives**
- O1: Pipeline reproducible with one command from raw FIRMS CSVs to app-ready files.
- O2: Harmonization validated on the overlap period (2012+): after adjustment, monthly MODIS-equivalent vs VIIRS totals per region agree within a stated error (report R², MAPE; target R² ≥ 0.8 for regions with enough counts — a target, not a promise).
- O3: No visible step change in the regional monthly series at sensor transitions (2002 Aqua start, 2012 S-NPP start, 2018 NOAA-20 start, 2024 NOAA-21 start, 2026 S-NPP end). Check by plot + change-point test.
- O4: App returns analytics for a 10-year, country-sized query in < 3 s (pre-aggregation required).
- O5: CSV export includes original per-sensor fields plus harmonized fields.

## 2. Part 1 — Harmonization (data pipeline)

### 2.1 Inputs
- FIRMS API sources (verified, `docs/data-notes.md` §2): `MODIS_SP`, `VIIRS_SNPP_SP` (archive only; ended 2 Nov 2026), `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_SP`. Area API: max 5 days per call, 5000 transactions per 10 minutes per key. Requires a FIRMS MAP_KEY: in Colab Secrets or an untracked local `.env`.
- Use **standard-processing (SP) archive**, not near-real-time (NRT), for history. NRT for the "current fire" feature only, labeled as provisional.
- Columns (exact CSV headers confirmed on the real download, `docs/data-notes.md` §8; MODIS `satellite` is `Terra`/`Aqua` in full words, not `T`/`A`): MODIS `brightness, bright_t31, confidence (0–100 %)`; VIIRS `bright_ti4, bright_ti5, confidence (low/nominal/high)`; both `latitude, longitude, scan, track, acq_date, acq_time, satellite, version, frp, daynight, type`. MODIS confidence classes: low < 30, nominal 30–79, high ≥ 80 (MODIS user guide Table 11). `type`: 0 vegetation fire, 1 volcano, 2 static land source, 3 offshore. Details: `docs/data-notes.md` §3–5.
- **Region (changed by Shrihan, 2026-11-15): California only.** The product, the website and `data/processed/` cover California (`US-CA`). Pará, New South Wales + Victoria and Portugal were downloaded and used to test the harmonization (`docs/validation/`); their data is archived in `archive/other_regions/` and on Drive, and is not part of the product. Scripts work on `ACTIVE_REGIONS` in `pipeline/config.py`.

### 2.2 Steps (each step = one script in `pipeline/`, with a unit test)
1. `01_download.py` — fetch per source/region in 5-day requests into `data/raw/<SOURCE>/<region>/<YYYY-MM-DD>_<n>d.csv` (one file per request; in Colab this folder is on Drive). Resumable: existing files are skipped. Prints row counts and value summaries per source.
2. `02_clean.py` — normalize to one schema (exact columns: `docs/pipeline-files.md`), one parquet file per region, source and year. Map MODIS `Terra`/`Aqua` → `T`/`A`; MODIS numeric confidence → low (<30), nominal (30–79), high (≥80), as in the MODIS user guide; VIIRS `l`/`n`/`h` → low/nominal/high. Drop exact duplicate rows. Keep every `type` (filtering is step 3).
3. `03_filter.py` — drop non-vegetation `type` (keep 0) and then low confidence, by default (configurable). Record how many dropped per sensor/year for each rule. Then `03b_sanity_checks.py` (S13) makes the Step A plots and tables.
4. `04_dedupe_and_grid.py` — assign each detection to a fixed grid (start: 0.25°; also keep 0.1° option) and to day. Within a sensor, merge same-day detections of the same satellite pass to avoid double counting adjacent-overpass pixels (rule documented and tested).
5. `05_calibrate.py` — core harmonization (see 2.3).
6. `06_aggregate.py` — build the app tables (see 2.4).
7. `07_validate.py` — produce plots + metrics for O2/O3 into `docs/validation/`.

### 2.3 Harmonization method (decide by experiment, document the winner)
Problem: VIIRS 375 m yields more detections per fire than MODIS 1 km. Use the overlap (2012–present, both sensors) to learn a mapping, apply it to estimate "MODIS-equivalent" counts for VIIRS-era data (or the reverse). Recommended baseline: **MODIS-equivalent as the reference scale** (longest record, so history stays unchanged).
- Candidate A (baseline): per grid cell × month, fit `modis_count ≈ f(viirs_count)` over the overlap; start with a log–log linear fit per region/biome and per season; apply `f` to VIIRS-only months.
- Candidate B: spatial re-aggregation — collapse VIIRS 375 m detections onto the MODIS 1 km footprint grid (count a MODIS-sized cell once if any VIIRS pixel is hot), then calibrate residual differences. Physically more defensible.
- Candidate C: quantile mapping of monthly count distributions per region.
- Also normalize **sensor-era changes inside MODIS**: Terra-only (Nov 2000–mid 2002) vs Terra+Aqua; treat per satellite or scale by overpass count. Terra/Aqua overpass-time drift in recent years was not found in the pages checked in S05 (still open, `docs/data-notes.md` §8). Use FRP-weighted activity as a secondary metric, since FRP is less count-sensitive.
- Output both `count_raw` and `count_harmonized`, plus `method_version` and an uncertainty band (e.g., residual std from the overlap fit).
- Pick the method by held-out validation: fit on 2014–2018 overlap, test on 2019–2023. (2012–2013 VIIRS had "numerous bad scan episodes", per the FIRMS FAQ, so they are excluded from fitting.) Also check NOAA-20 vs S-NPP vs NOAA-21 against each other in their overlap years, because S-NPP has ended and the VIIRS record continues on NOAA-20/21 only. Report honestly where it fails (small regions, low counts, cloud/smoke-heavy areas).

### 2.4 Output data products (what the app reads)
The exact field-by-field definition is `docs/data-contract.md` (machine-checkable schemas in `docs/schemas/`); the list below is a summary. Committed to `data/processed/` (or hosted release assets if too large):
- `daily_grid.parquet`: `date, cell_id, count_raw_modis, count_raw_viirs, count_harm, frp_sum`
- `monthly_region.json` per region: `year, month, count_harm, count_low, count_high, n_days_observed`
- `regions.geojson`: selectable regions (countries, states/provinces, plus user-drawn polygon support using cell lookup)
- `anomaly_baseline.json`: per region × month climatology (mean, std, percentiles) for the anomaly color ramp
- `metadata.json`: method version, build date, sensors included, known gaps
Keep per-detection points in tiled/compressed files for CSV export (sharded by region-year).

## 3. Part 2 — Web application

### 3.1 Required behavior
1. **Region selection:** (a) dropdown/search of countries and admin-1 units; (b) draw rectangle/polygon on map; (c) click map to pick a region. Show selected area in km².
2. **Date range:** start/end date pickers plus presets (last 30 days, last year, fire season, all time). Validate range within data coverage.
3. **Summary panel:** total hotspots (harmonized), raw counts by sensor (collapsible), peak month, peak year, FRP total, % high-confidence.
4. **Burning Activity Calendar (centerpiece):**
   - Grid: rows = years (2000→present), columns = 12 months. Each cell = harmonized hotspot count.
   - Color ramp: perceptually uniform sequential (viridis/YlOrRd). Color scale options: *absolute* (counts, log scale), *percentile within this region*, *anomaly vs. monthly climatology* (diverging, blue–white–red). Default = log absolute; toggle to anomaly.
   - Colorblind-safe, with a legend, and numeric value in tooltip + as cell text optionally. Missing data shown with hatching (not zero).
   - Hover: count, rank among all same-month years, anomaly %, and sensor mix. Click a cell → map filters to that month and shows its daily bars.
   - Row/column marginals: yearly total bar to the right, monthly climatology bar on the bottom.
   - Optional daily-resolution calendar (GitHub-style heatmap) for a chosen year.
   - Mark sensor-transition years with subtle markers and a note linking to method docs.
5. **Charts:** monthly time series with uncertainty band; yearly totals; seasonal cycle (box/violin per month); cumulative-year curves overlaying the selected/current year on past years (“how does this year compare”).
6. **Map:** hotspot points/density for selected dates, colored by sensor or FRP; basemap toggle.
7. **Current-fire comparison:** user picks a fire (date range + region, or NRT recent window); app shows its hotspot count/FRP vs. percentile of historical same-season windows in that region, and lists the most similar past episodes.
8. **Downloads:** 
   - CSV of hotspots matching the query. Columns: `date, time_utc, latitude, longitude, sensor, satellite, confidence, frp, daynight, harmonized_weight, region_id`. Header comment lines with query, method version, data build date, citation.
   - Calendar data CSV (year × month matrix) and chart PNG/SVG export.
   - Row cap with clear message and a "download in chunks by year" fallback for huge queries.
9. **Methods & limits page:** plain-language explanation, validation plots, known caveats, FIRMS/NASA citation and licence note.

### 3.2 Interactive suggestions
- Brush on the yearly bar chart to set the date range; calendar and map update together (linked views).
- “Compare regions” mode: two regions’ calendars side by side with shared color scale.
- “Compare years” mode: pin up to 3 years as overlay lines.
- Shareable URL encoding region, dates, color mode.
- Keyboard-accessible calendar cells; ARIA labels; light/dark theme; mobile layout.
- Toggle between harmonized and raw-by-sensor to let skeptics see the difference.
- Anomaly alert banner: “This month is in the top 5% for <region> since 2000”.

### 3.3 Non-functional
- Static-hostable if possible; queries answered from pre-aggregated files for speed.
- Accessible (WCAG AA contrast), documented data licence, no secrets in the client.

## 4. Proposed stack (editable; confirm with team)
- Pipeline: Python 3.11, pandas/pyarrow/geopandas, DuckDB for aggregation, pytest.
- Front end: Vite + TypeScript, MapLibre GL, D3 (calendar heatmap + charts), a CSV built client-side from sharded files, or a small FastAPI if size forces it.
- Hosting: GitHub Pages (static) first.

## 5. Repository layout
```
README.md              # this plan
pipeline/              # 01..07 scripts + tests
data/raw|processed/    # raw is gitignored; processed small files tracked (or Releases)
data/interim_extract/  # small committed extract of the cleaned/filtered data (full interim data is on Drive)
docs/validation/       # plots + metrics
docs/data-notes.md     # verified facts about FIRMS data (step S05)
docs/data-contract.md  # exact shape of the files the app reads (step S07)
docs/schemas/          # JSON Schemas for the data contract (used to validate files)
docs/sources.md        # every source used with FIRMS, with status and licence
docs/HANDOFF.md        # running log: one entry per step, newest first
scripts/               # make_sample_fixtures.py, validate_data.py
tests/                 # pytest tests (no downloads)
requirements.txt       # Python packages
web/                   # app source
notebooks/             # Colab notebook that runs the pipeline (Section 14)
web/fixtures/          # small fake sample files that follow the data contract
.env.example           # FIRMS_MAP_KEY=
```

## 6. Work breakdown
Work happens one person at a time, at different times (see Section 9). So steps are not assigned to a fixed person: whoever starts a shift takes the next unticked step in Section 10. The suggested lead below is only a default.

| Task | What | Default lead | Needs | Done when |
|------|------|-------------|-------|-----------|
| 1.1 | Verify sensor dates, columns, confidence mapping against FIRMS docs; write `docs/data-notes.md` | Shrihan | — | Facts in this README confirmed/corrected |
| 1.2 | Download + clean pilot regions (01–03) | Shrihan | 1.1 | Unified schema files exist, tests pass |
| 1.3 | Grid/dedupe + calibration experiments A/B/C (04–05) | Shrihan | 1.2 | Metrics table comparing methods |
| 1.4 | Validation + aggregation outputs (06–07) | Shrihan | 1.3 | Data products in 2.4 generated |
| 2.0 | Data contract + sample fixture files (Section 11.4) | Yash | — | `web/fixtures/` exists |
| 2.1 | App scaffold, region + date selection, summary panel | Yash | 2.0 | Works on fixture JSON |
| 2.2 | Calendar heatmap with 3 color modes | Yash | 2.1 | Matches spec 3.1.4 |
| 2.3 | Charts, map, CSV export, methods page | Yash | 2.1, 1.4 | Spec 3.1 complete |
| 3.1 | Integrate real data, current-fire comparison, polish, demo script | either | 1.4, 2.3 | End-to-end demo |

The step-by-step version is the checklist in Section 10. Every step ends with an entry in `docs/HANDOFF.md`.

## 7. Risks and open questions
- Count mapping may vary by region/biome; a single global fit may be wrong → fit per region, report error.
- The VIIRS→MODIS-scale mapping is learned on the 2014+ overlap. It matters most for any period where MODIS data is missing or ends. The FIRMS FAQ lists Terra and Aqua data as available "to the present" (checked 2026-11-14); their future end date was not found. Using the mapping there assumes the relationship stays the same over time; document this assumption.
- S-NPP stopped on 2 November 2026. Any S-NPP-based calibration must be transferred to NOAA-20/NOAA-21, which fly in the same orbit about 50 minutes apart (FIRMS FAQ).
- Detection depends on overpass time, cloud, and smoke; harmonization does not fix undercounting from these.
- Data size for global per-detection export → shard by region-year.
- NRT vs. SP data differ; keep NRT separate and labeled.
- Citation (FIRMS FAQ): cite imagery as "NASA FIRMS"; for scientific use: "We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS)." The LANCE Disclaimer is still to be read.

## 8. Definition of done
Pipeline reproduces from raw; validation report published; web app deployed; calendar, analytics, and CSV work for the pilot regions; methods page honest about uncertainty.

---

## 9. Team, shifts, and AI tools

Shrihan and Yash do **not** work at the same time. Each person works in their own sessions, uses Claude Code or Codex, and then stops. The next person (or the next AI) must be able to continue without asking anyone anything. So:

- **The repo is the memory.** Nothing important lives only in a chat. Every step is written down in `docs/HANDOFF.md` (Section 11).
- **Work is one line, not two.** There is a single checklist (Section 10). Whoever starts a shift takes the next unticked step whose "Needs" are done.
- **Leads, not walls.** Shrihan leans backend (`pipeline/`, `data/`), Yash leans website (`web/`). That is a default for who picks which step, not a rule. Anyone can do any step.
- **Either AI can do any step.** Claude Code reads `CLAUDE.md`; Codex reads `AGENTS.md`. Both files point to the same README and handoff log.
- **Review happens at the next shift.** The person who starts the next shift reads the last handoff entry, runs the "How to check it" commands, and notes anything wrong at the top of their own entry.

## 10. Step-by-step checklist

One list, done in order. Tick a box (`- [x]`) in the same commit that finishes the step. If you need to skip ahead, check the step's "Needs" first. Every step ends with a handoff entry in `docs/HANDOFF.md` (template in that file).

Each step has: **Needs** (steps that must be ticked first), **Do** (the work), **Done when** (how you know), and **Leave behind** (what the next person finds in the repo).

### Phase 0 — Setup
- [x] **S01 Read the plan.** Needs: —. Do: read this README, `CLAUDE.md` or `AGENTS.md`, and `docs/HANDOFF.md`. Done when: you can say in one sentence what the project builds. Leave behind: a "STARTED" entry.
- [x] **S02 Tools installed.** Needs: S01. Do: install Python 3.11+ and Node.js 20+ (check `python3 --version`, `node --version`). Done when: both print a version. Leave behind: versions in the handoff entry.
- [x] **S03 FIRMS key.** Needs: S01. Do: request a free FIRMS MAP_KEY (via the "Get MAP_KEY" link on https://firms.modaps.eosdis.nasa.gov/api/area/) and put it in `.env` as `FIRMS_MAP_KEY=...`. Done when: `.env` exists locally. Leave behind: `.env.example` with `FIRMS_MAP_KEY=` (empty) committed. **Update (Shrihan, 2026-11-14):** `.env` was briefly committed and has been removed again. The key now lives in Colab Secrets (`FIRMS_MAP_KEY`), and anyone running locally keeps it in an untracked `.env` file. Because the key was in git history, treat it as exposed to anyone with repo access, and request a new key if the repo ever goes public.
- [x] **S04 Pilot regions agreed.** Needs: S01. Do: confirm the 4 pilot regions (default: California, Pará in Brazil, NSW/Victoria in Australia, Portugal) or change them. Done when: final list written in Section 2.1.

### Phase 1 — Check the facts
- [x] **S05 Verify FIRMS facts.** Needs: S01. Do: read the FIRMS docs for MODIS C6.1 and VIIRS 375 m active fire. Done when: `docs/data-notes.md` lists start date per satellite, exact CSV columns per sensor, meaning of each confidence value, meaning of `type`, licence and citation, with a link to the source for each fact. Leave behind: that file.
- [x] **S06 Fix the README.** Needs: S05. Do: correct anything wrong in Sections 0, 2.1, 7. Done when: no "verify" note is left that S05 answered.

### Phase 2 — Data contract
- [x] **S07 Write the contract.** Needs: S05. Do: write the JSON schema for each app file in Section 2.4 into `docs/data-contract.md`, starting from the example in Section 11.4. Done when: every field has a type, meaning, and an example.
- [x] **S08 Fake sample data.** Needs: S07. Do: make small fake files in `web/fixtures/` (1 region, 3 years) that follow the schema exactly, with `"is_sample": true`. Done when: a script or test validates them against the contract.

### Phase 3 — Get and clean data
- [x] **S09 Download one region-year.** Needs: S03, S05. Do: `pipeline/01_download.py` for one pilot region and one year, both sensors (run it locally or in Colab, Section 14). First call `/api/data_availability/` to get the exact `_SP` date ranges, and check the CSV headers, `confidence` format and presence of `type` against `docs/data-notes.md` §8; update that file with what you find. Done when: files open and have rows. Leave behind: the exact command and row counts in the handoff entry.
- [x] **S10 Download everything.** Needs: S09. Do: extend to all pilot regions and years (2000 to now), resumable. Done when: a table of files and row counts is in the handoff entry. Raw files stay in `data/raw/` (not committed), so write how to re-create them.
- [x] **S11 Clean.** Needs: S10. Do: `02_clean.py` into the single schema (Section 2.2) plus a test on 5 known rows. Done when: test passes.
- [x] **S12 Filter.** Needs: S11. Do: `03_filter.py`; print how many were removed per sensor per year. Done when: counts are in `docs/validation/`.
- [x] **S13 Sanity checks.** Needs: S12. Do: Section 13, Step A. Done when: plots saved in `docs/validation/` with a short written reading of each.

### Phase 4 — Harmonize
- [x] **S14 Grid and dedupe.** Needs: S12. Do: `04_dedupe_and_grid.py`; test that no detection is lost or counted twice. Done when: test passes.
- [x] **S15 Calibration experiments.** Needs: S14. Do: `05_calibrate.py`, Candidate A first, then B and C (Section 2.3). Done when: all three run and save results.
- [x] **S16 Compare and choose.** Needs: S15. Do: Section 13, Steps B–D. Done when: `docs/validation/README.md` states the winning method, the metrics table, and where it works badly.
- [x] **S17 Aggregate.** Needs: S16, S07. Do: `06_aggregate.py` writes `data/processed/` following the contract exactly. Done when: output validates against the contract.
- [x] **S18 Validate command.** Needs: S17. Do: `07_validate.py` re-creates all validation plots and the metrics table in one command. Done when: it runs from scratch.
  - Done 2026-11-16: `python3 pipeline/07_validate.py` re-runs steps 05 and 05b, checks California against the committed `docs/validation/S16/`, and checks `data/processed/`, the forecast and that the website uses only our data (14 checks, report in `docs/validation/S18/README.md`). It never overwrites S16 (that folder also holds the three archived regions).

### Phase 5 — Website (can start after S08; does not need S10–S18)
- [x] **S19 Scaffold.** Needs: S08. Do: Vite + TypeScript app in `web/`, blank map loads. Done when: the run command is written in `CLAUDE.md` and `AGENTS.md`.
- [x] **S20 Pickers and summary.** Needs: S19. Do: region picker (dropdown + draw), date range with presets, summary panel from `web/fixtures/`.
- [x] **S21 Calendar.** Needs: S20. Do: years x months heatmap, 3 color modes, legend, tooltips, hatching for missing data (spec 3.1.4). Done when: it looks right for the sample region.
- [x] **S22 Charts.** Needs: S20. Do: monthly series, yearly totals, seasonal cycle.
- [x] **S23 CSV download.** Needs: S20. Do: CSV of the current query (columns in Section 3.1.8).
- [x] **S24 Phone and keyboard check.** Needs: S21. Done when: works on a phone-sized screen and with keyboard only.

### Phase 6 — Connect and finish
- [x] **S25 Real data in.** Needs: S17, S21. Do: switch the app from `web/fixtures/` to `data/processed/`. Done when: nothing else needed changing. If something did, the contract was broken: fix the contract or pipeline, not the app.
- [x] **S26 Check the calendar.** Needs: S25. Do: Section 13, Step E.
- [x] **S27 Map and current-fire comparison.** Needs: S25.
- [x] **S28 Methods page and write-up.** Needs: S26. Do: Section 13, Step F, and the known-limits list.
  - Done 2026-11-16. S25 note: switching needed no change to the app's numbers, but the hotspot files were split per month (contract §7 updated, app loader updated) so the app loads only the months it needs. S26 results: `docs/validation/S26/README.md`. Methods page: `web/methods.html`.
- [x] **S29 Deploy.** Needs: S28. Do: GitHub Pages.
  - Done 2026-11-16: `.github/workflows/pages.yml` builds `web/` with `data/processed/` and deploys on every push to `main` that changes the site or data. Live: https://shrihanchada-rgb.github.io/NASA-Space-Apps---YASH-AND-SHRIHAN/ (the deploy job reports success; the live page was not opened from the AI session).
- [x] **S30 Full rebuild test.** Needs: S29. Do: run the whole pipeline from an empty `data/processed/` and check the app still works.
  - Done 2026-11-16 for the steps that run from the repo plus the filtered files: `06_aggregate.py --out <empty folder>` rebuilt `data/processed/` in 16 s; 319 of 321 files are byte-identical to the published ones (the other two are the hand-written README and the forecast file made by the Actions job); `validate_data.py` 0 problems on the rebuild. Steps 01–04 (download, clean, filter, grid) need Colab and were not re-run.
- [x] **S31 Demo.** Needs: S30. Do: write and rehearse a 3-minute demo (pick a region, show calendar, show worst year, compare a recent fire, download CSV). Done when: everything in Section 8 is true.
  - Done 2026-11-16: script, timings, answers to likely questions and the Section 8 check are in `docs/demo.md`; `scripts/rehearse_demo.js` performs every click on the real data (18/18 checks) and saves a screenshot per step to `docs/demo/`. Section 8: validation report, calendar/analytics/CSV for California and honest methods page are verified; "reproduces from raw" is verified from the filtered files only (steps 01–04 ran in Colab earlier); "deployed" is verified by the Actions deploy job, and the live page still needs a person to open it.

---

## 11. How to hand work over (read this at the start and end of every shift)

### 11.1 Start of a shift (5 minutes)
1. `git checkout main && git pull`.
2. Open `docs/HANDOFF.md` and read the **newest entry** (entries are newest first). If it says `PAUSED`, there is an unmerged branch named in it: check that branch out and continue from the "Resume" command.
3. Read the entry's "How to check it" section and run it. If it does not work, say so at the top of your own entry before doing anything else.
4. Pick the next unticked step in Section 10 whose "Needs" are ticked.
5. Add a `STARTED` entry to the top of `docs/HANDOFF.md` and push it so the other person can see the step is taken.

### 11.2 During the shift
1. Branch name: `step/S<number>-<short-name>`, for example `step/S21-calendar`.
2. Commit small, working pieces and **push often** (at least every hour). If the session ends suddenly, the work is still on GitHub.
3. Write decisions down as you go (what you chose, what you rejected, why) in the step's own doc (`docs/data-notes.md`, `docs/data-contract.md`, or `docs/validation/README.md`), not only in chat.

### 11.3 End of a shift or step
1. Finished? Merge the step branch into `main` (pull request), tick the box in Section 10 in the same change. Not finished? Push the branch and write a `PAUSED` entry (see below).
2. Add the handoff entry to the top of `docs/HANDOFF.md`, using the template at the top of that file.
3. Make sure `main` is always runnable: if it is not, fix it or revert before you stop.

A handoff entry must let someone with zero chat context continue. It contains: step id and status (`DONE` / `PAUSED` / `BLOCKED`), who and which AI, date, what was done, files changed, **how to check it (exact commands and expected output)**, numbers/results, decisions and why, problems and open questions, **next step**, and for `PAUSED` the branch name and the exact command to resume.

### 11.4 The data contract (how the website and pipeline connect)
The app never reads raw data. It only reads the files listed in Section 2.4. Their exact shape is in `docs/data-contract.md`. Example of one region's monthly file:

```json
{
  "region_id": "US-CA",
  "region_name": "California",
  "method_version": "A-0.1",
  "build_date": "2026-11-20",
  "is_sample": false,
  "months": [
    { "year": 2020, "month": 8, "count_harm": 15230, "count_low": 13900, "count_high": 16560,
      "count_raw_modis": 15010, "count_raw_viirs": 61200, "n_days_observed": 31 }
  ]
}
```
(The numbers above are invented for the example only.)

Rules:
- `count_harm` is the harmonized number the calendar shows. `count_low`/`count_high` are the uncertainty band.
- A month with no data has `count_harm: null`, never `0`. Zero means "we looked and found no fires".
- Changing the contract means both people must know. Put the change at the top of your handoff entry and update both the fixtures and the pipeline in the same step, so the next shift does not hit a mismatch.

---

## 12. How to prompt the AIs

Either person can use either AI on any task: the AI follows the task, not the person. Claude Code can work on the website or the pipeline, and so can Codex. Both tools read their instruction file automatically (`CLAUDE.md` for Claude, `AGENTS.md` for Codex), so you do not need to re-explain the project every time. You do need to be specific about the task.

### 12.1 Rules for good prompts (both AIs)
1. **One step per prompt.** Give the step ID from Section 10 ("Do step S21"), not "build the app".
2. **Say what goes in and what comes out.** Name the input files and the exact output file and format.
3. **Say how you will check it.** "Done when the test passes", "done when the calendar shows 3 years from `web/fixtures/`".
4. **Say which files the task should change.** "Edit files in `web/` for this task." Keep it small so changes are easy to review.
5. **Forbid fake data.** "Do not invent numbers. If data is missing, stop and tell me."
6. **Ask for proof.** "Show me the commands you ran and their output."
7. **Ask it to ask.** "If something is unclear, ask me before guessing."
8. **Small steps.** If the AI's answer is very long or changes many files, ask it to split the work.
9. **Always end with the handoff.** The AI must tick the step and write the `docs/HANDOFF.md` entry. The next person may be on a different AI.

### 12.2 Example prompt — website task (works for Claude or Codex)
```
Task: <step ID and name from README Section 10, e.g. S21 Calendar>
Read first: README.md Section 3.1.4, docs/data-contract.md, docs/HANDOFF.md (newest entry)
Input: web/fixtures/monthly_region.sample.json
Output: a calendar component in web/src/, shown on the main page
Must: 3 color modes (log count, percentile, anomaly), legend, tooltip with count/rank/anomaly,
      hatching for null months, keyboard accessible.
Edit: web/ for this task
Do not: change the data contract, invent data, add a backend.
Done when: `npm run dev` shows the calendar for the sample region and `npm test` passes.
Show me: the commands you ran and their output, and a screenshot if you can.
If anything is unclear, ask me first.
Last: tick the step in README Section 10 and add an entry to docs/HANDOFF.md
      using its template (what you did, how to check it, results, decisions, next step).
```

### 12.3 Example prompt — data pipeline task (works for Claude or Codex)
```
Task: <step ID and name from README Section 10, e.g. S11 Clean>
Read first: README.md Section 2.2, docs/data-notes.md, docs/HANDOFF.md (newest entry)
Input: data/raw/<sensor>/<year>.csv
Output: data/interim/clean_<sensor>_<year>.parquet with columns exactly:
        lat, lon, date, time_utc, sensor, satellite, confidence_class, frp, daynight, type
Edit: pipeline/ and tests under tests/ for this task
Do not: hard-code facts not in docs/data-notes.md, download data in tests, invent rows.
Done when: `python3 -m pytest -q tests -k clean` passes and the script prints rows in/out per sensor.
Show me: the commands you ran and their output.
If a column is missing or different from docs/data-notes.md, stop and tell me.
Last: tick the step in README Section 10 and add an entry to docs/HANDOFF.md
      using its template (what you did, how to check it, results, decisions, next step).
```

### 12.4 Checking what the AI gave you (do this every time)
- [ ] Run it yourself. Do not trust "it works" without seeing it work.
- [ ] Read the diff. Does it only touch the files the step needed?
- [ ] Is the handoff entry written, with commands someone else can run?
- [ ] Look for invented values: hard-coded counts, made-up dates, fake column names.
- [ ] Check one number by hand. Example: count the rows for one day in the raw CSV and compare with what the pipeline or app says.
- [ ] If it is wrong, tell the AI exactly what is wrong and paste the error, instead of asking it to "try again".

### 12.5 Handing work between the two AIs
The AIs do not talk to each other, and chats are not shared. They share information only through the repo. So:
- Write decisions down in files (`docs/HANDOFF.md`, `docs/data-notes.md`, `docs/data-contract.md`, `docs/validation/README.md`), not only in chat.
- If you stop in the middle of a step, push the branch and write a `PAUSED` entry (Section 11.3) with the exact command to resume. Start the next AI with: "Read README.md and the newest entry in docs/HANDOFF.md, then continue from it."

---

## 13. How to analyze the data (step by step)

These steps are done during the steps named in Section 10 (Step A in S13, Steps B–D in S16, Step E in S26, Step F in S28). Whoever is on shift does the analysis and writes the findings into `docs/validation/` so the next person can read them without redoing the work. Save every plot there with a clear file name, and write one or two sentences next to each plot saying what it shows. The next person checks the numbers at the start of their shift (Section 11.1).

### Step A — Sanity checks on cleaned data (step S13)
1. For each pilot region, plot **hotspots per year, one line per sensor** (MODIS and VIIRS separately).
   - Expect: VIIRS line much higher than MODIS from 2012 on (smaller pixels see more). MODIS line starts in 2000.
2. Plot **hotspots per month of the year** (all years added together).
   - Expect: a clear fire season. Write down which months peak. If there is no peak at all, something may be wrong.
3. Check for **gaps**: list any month with zero detections from a sensor that should have been working. Gaps from missing files are bugs; gaps that are real (no fires) are fine.
4. Check the **filters**: what % was removed as low-confidence or non-vegetation? If a filter removed more than about half the data, look at why before moving on.

### Step B — Compare the sensors in the overlap years (2012 → now)
1. For each region and month in the overlap, put MODIS count and VIIRS count side by side.
2. Make a scatter plot: MODIS on one axis, VIIRS on the other, both on log scale.
   - If the points form a tight line, a simple conversion will work. If they are spread out, conversion will be less accurate.
3. Compute the ratio VIIRS ÷ MODIS for each month. Plot this ratio over time and by month of year.
   - If the ratio is steady, good. If it changes by season or region, the conversion must be done per season or per region.

### Step C — Test each harmonization method fairly
1. Split the overlap years: **train** on 2014–2018, **test** on 2019–2023 (2012–2013 VIIRS excluded, see Section 2.3).
2. For each method (A, B, C): learn the conversion on train years only, then convert VIIRS counts in test years to "MODIS-equivalent".
3. Compare converted numbers with the real MODIS numbers in test years. Compute:
   - **R²** (closer to 1 is better),
   - **typical % error** (median of |converted − real| ÷ real, only for months where real ≥ 10, to avoid dividing by tiny numbers),
   - **total bias** (sum of converted ÷ sum of real; 1.0 means no bias).
4. Put the results in one table: rows = methods, columns = regions × metrics.

### Step D — Choose the method
1. Pick the method that is best on the test years in most regions. Simpler wins ties.
2. Write in `docs/validation/README.md`: which method, why, the metrics table, and where it works badly.
3. Set `method_version` in the pipeline to match (for example `A-1.0`).

### Step E — Check the final calendar makes sense (step S26)
1. Open the app for each pilot region.
2. Does the fire season in the calendar match Step A.2? It should.
3. Is there a jump in colour around 2012 that is not explained by a real event? If yes, harmonization is not working well enough — go back to Step C.
4. Look at the worst years in the calendar. Can you find a news report or published source about big fires in that region and year? Write down which years you could confirm and the source. Do not claim a confirmation you did not find.
5. Download the CSV for one month and check that its row count matches what the app shows.

### Step F — Write up what you found
For each region, write 3–5 short sentences on the methods page: peak months, most active years, any trend, and how sure we are (from the Step C numbers). Use plain words, because emergency managers will read it.

---

## 14. Running the pipeline in Google Colab

Downloading 25 years of FIRMS data and running the harmonization is heavy. Colab can do that on Google's machines instead of a laptop. The code still lives in this repo; Colab only runs it.

**The notebook:** `notebooks/run_pipeline_colab.ipynb`. It clones this repo, installs packages, loads the FIRMS key from Colab Secrets, keeps `data/raw` and `data/interim` on Google Drive (so downloads survive a restart), runs the pipeline scripts you choose, runs the tests, and prints a summary. Status: in use since S09; step 01 (download) runs in it. Since the repo is private, it loads the code from `repo.zip` in Drive instead of cloning, and then `BRANCH` is ignored: to run other code, upload a fresh zip.

### 14.1 One-time setup (each person, once)
1. The repo is private, so Colab's GitHub tab may not list it. Reliable way: on GitHub open `notebooks/run_pipeline_colab.ipynb`, click Download raw file, then in Colab use File → Upload notebook.
1a. Download the code: on GitHub click Code → Download ZIP, upload the file to your Drive as `My Drive/nasa-fire-calendar/repo.zip`. The notebook unzips it (no GitHub login needed). Re-upload a fresh zip whenever the code changes.
2. Click the key icon (Secrets) in the left bar. Add a secret `FIRMS_MAP_KEY` with your FIRMS key (step S03) and turn on "Notebook access".
3. Run the cells top to bottom once with `STEPS = []` to check setup works. Expect "nothing to run".

### 14.2 Doing a pipeline step in Colab
1. Pull `main` and read the newest `docs/HANDOFF.md` entry as usual (Section 11.1).
2. In Colab, set `BRANCH` (default `main`) and `STEPS`, for example `["01"]`, then run all cells. Start with one region and one year (S09) before running everything (S10).
3. Raw and interim files land in `My Drive/nasa-fire-calendar/` and are reused by the next run, by either person, if the Drive folder is shared.
4. Colab sessions are wiped when they end, so **copy the summary from the last cell into your `docs/HANDOFF.md` entry**, with the exact `STEPS` and `BRANCH` you used. Record file counts and sizes, not the files.

### 14.3 Rules for Colab
- Code changes happen in the repo, not in the notebook. If a script needs fixing, fix it in `pipeline/`, commit, push and merge, then upload a fresh `repo.zip` of `main` to Drive and re-run the notebook (it does not pull from GitHub by itself). Do not leave fixes only inside a Colab cell.
- Never paste the FIRMS key into a cell or a handoff entry.
- Large data stays on Drive. Small outputs the website needs (`data/processed/`) are downloaded from Drive and committed from a laptop, or via the repo if they are small. Do not put a GitHub token into Colab.
- Share the Drive folder `nasa-fire-calendar` with the other person (Drive → Share) so both can reuse the same raw downloads. If you cannot share, the other person must re-download, which takes time.
- Use one device and one Colab session at a time. Old cell outputs stay on screen until re-run, and two sessions with the same FIRMS key share its limit (see `CLAUDE.md`/`AGENTS.md`, "Project state and lessons so far").
- A free Colab session can disconnect after a few hours or when idle. The scripts must be resumable (S09, S10), so rerunning continues instead of starting over.

### 14.4 Using the AIs with Colab
Claude Code and Codex cannot control a Colab session. They write and fix the code in the repo; a person runs it in Colab and brings the results back through the handoff entry. When prompting an AI, paste the Colab error output in full, and say which `STEPS` and `BRANCH` you ran. Start any prompt with: "Read README.md and the newest entry in docs/HANDOFF.md."

## Updated submission and forecast integration

The Yash?Shrihan repository is the main project. The editable, seven-slide submission deck is `submission/Yash-Shrihan-Submission.pptx`; rebuild instructions and speaker notes are in `submission/README.md`. The Timestral-5M method adapted from `yashneil75/califire` runs on **this repository?s harmonized daily data** using `pipeline/07_forecast.py`. Forecast completion on main triggers the Pages build; stale or malformed forecast files are withheld by the app. The current archive ends 2026-08-31, so its seven-day forecast is historical.

## S33: Nightly data update

- The `Nightly data refresh` GitHub Actions workflow runs every day at **00:00 America/Chicago**, including daylight-saving changes. It can also be run manually from Actions.
- Required repository secret: `FIRMS_MAP_KEY` (NASA FIRMS). Never put the key in code or logs.
- `pipeline/08_refresh_nrt.py` preserves the standard-processing archive and adds provisional MODIS/VIIRS NRT observations through the latest completed UTC day. It fills any available dates after the archive and refetches the last 14 days for revisions. Exact source/date windows are replaced so reruns cannot accumulate duplicate detections.
- The published calibration and historical baseline remain fixed. NRT may omit fire-type classification; such observations are labeled provisional thermal anomalies, not asserted to be vegetation fires. Source outages and unavailable dates remain missing.
- The job validates data contracts and the independent arithmetic audit, rebuilds the Timestral forecast, checks the website, and commits only after every check passes. A successful run triggers the Pages deployment. Fetch or validation failure leaves published data unchanged.
- Source coverage and unfiltered per-satellite counts are retained in `data/processed/regions/US-CA/nrt-state.json` to find gaps and apply revisions. Raw FIRMS responses and credentials are not committed.
- GitHub scheduled starts can be delayed. Midnight is the scheduled start, not a guarantee that data publication finishes at exactly midnight. NASA availability and processing lag still apply; unavailable historical gaps are not fabricated.

Local check (with FIRMS_MAP_KEY set securely): `python pipeline/08_refresh_nrt.py`, then `python pipeline/07_forecast.py`. Offline tests: `python -m pytest -q tests`.
