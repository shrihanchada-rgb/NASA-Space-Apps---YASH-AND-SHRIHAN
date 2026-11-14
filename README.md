# NASA Space Apps — Harmonized Burning Activity Calendar (MODIS + VIIRS)

> Team: Yash and Shrihan. This README is the single source of truth for what to build, so humans and AI coding agents (e.g. Codex) can work on the same problem without overlap.
> Status: planning. No code yet. Facts marked "verify" must be checked in Task 1.1 before code depends on them.

---

## 0. Context
NASA FIRMS has two active-fire records: MODIS (Terra from Nov 2000, Aqua from mid-2002, ~1 km pixels) and VIIRS (S-NPP from 2012, NOAA-20 from ~2018/2020, NOAA-21 from ~2024; 375 m pixels). VIIRS detects more, smaller fires, so raw counts are not comparable across sensors; a naive concatenation creates a fake jump in 2012. Emergency managers need one consistent hotspot history per place. Goal: harmonize, then expose it via a web app with region + date selection, analytics, a burning-activity calendar (color ramp), and CSV export.

(Sensor start dates and column names above are from memory; Task 1.1 must verify them against the FIRMS docs before any code depends on them.)

## 1. Mission / Goals / Objectives

**Mission:** Make 25 years of satellite fire detections comparable, so users judge fire activity (seasonality, anomalies, current fire vs. history) without caring which sensor saw it.

**Goals**
1. G1 — One consistent hotspot time series, ~2000–present, sensor-agnostic.
2. G2 — A web app where a user picks a region and date range and gets analytics, charts, a calendar, and a CSV.
3. G3 — Transparency: every harmonized number traceable to method + uncertainty.

**Measurable objectives**
- O1: Pipeline reproducible with one command from raw FIRMS CSVs to app-ready files.
- O2: Harmonization validated on the overlap period (2012+): after adjustment, monthly MODIS-equivalent vs VIIRS totals per region agree within a stated error (report R², MAPE; target R² ≥ 0.8 for regions with enough counts — a target, not a promise).
- O3: No visible step change in the regional monthly series at sensor transitions (2012 VIIRS start, 2002 Aqua start, NOAA-20/21 starts). Check by plot + change-point test.
- O4: App returns analytics for a 10-year, country-sized query in < 3 s (pre-aggregation required).
- O5: CSV export includes original per-sensor fields plus harmonized fields.

## 2. Part 1 — Harmonization (data pipeline)

### 2.1 Inputs
- FIRMS archive downloads (CSV/shapefile): MODIS C6.1 (`MODIS_C6_1`), VIIRS S-NPP (`VIIRS_SNPP_SP` standard processing for archive), VIIRS NOAA-20 (`VIIRS_NOAA20_SP`), NOAA-21 if available. Requires a FIRMS MAP_KEY for API use; store in `.env`, never commit.
- Use **standard-processing (SP) archive**, not near-real-time (NRT), for history. NRT for the "current fire" feature only, labeled as provisional.
- Columns (verify): MODIS `brightness, bright_t31, confidence(0–100)`; VIIRS `bright_ti4, bright_ti5, confidence(l/n/h)`; both `latitude, longitude, scan, track, acq_date, acq_time, satellite, instrument, frp, daynight, type`.
- Pilot regions first (fire-rich, different regimes): California, Amazon/Pará (Brazil), Australia NSW/Victoria, Portugal/Iberia. Scale to global later.

### 2.2 Steps (each step = one script in `pipeline/`, with a unit test)
1. `01_download.py` — fetch per sensor/year/region into `data/raw/<sensor>/<year>.csv`. Resumable, logs checksums.
2. `02_clean.py` — normalize to one schema: `lat, lon, date, time_utc, sensor, satellite, confidence_class (low/nominal/high), frp, daynight, type`. Map MODIS numeric confidence → low (<30), nominal (30–79), high (≥80); VIIRS l/n/h as-is. Drop `type != 0` (non-vegetation fire: volcano, static source, offshore) by default; keep as a flag.
3. `03_filter.py` — drop low-confidence by default (configurable). Record how many dropped per sensor/year.
4. `04_dedupe_and_grid.py` — assign each detection to a fixed grid (start: 0.25°; also keep 0.1° option) and to day. Within a sensor, merge same-day detections of the same satellite pass to avoid double counting adjacent-overpass pixels (rule documented and tested).
5. `05_calibrate.py` — core harmonization (see 2.3).
6. `06_aggregate.py` — build the app tables (see 2.4).
7. `07_validate.py` — produce plots + metrics for O2/O3 into `docs/validation/`.

### 2.3 Harmonization method (decide by experiment, document the winner)
Problem: VIIRS 375 m yields more detections per fire than MODIS 1 km. Use the overlap (2012–present, both sensors) to learn a mapping, apply it to estimate "MODIS-equivalent" counts for VIIRS-era data (or the reverse). Recommended baseline: **MODIS-equivalent as the reference scale** (longest record, so history stays unchanged).
- Candidate A (baseline): per grid cell × month, fit `modis_count ≈ f(viirs_count)` over the overlap; start with a log–log linear fit per region/biome and per season; apply `f` to VIIRS-only months.
- Candidate B: spatial re-aggregation — collapse VIIRS 375 m detections onto the MODIS 1 km footprint grid (count a MODIS-sized cell once if any VIIRS pixel is hot), then calibrate residual differences. Physically more defensible.
- Candidate C: quantile mapping of monthly count distributions per region.
- Also normalize **sensor-era changes inside MODIS**: Terra-only (Nov 2000–mid 2002) vs Terra+Aqua; treat per satellite or scale by overpass count. Check Terra overpass-time drift in recent years (to verify; may need Terra-only treatment). Use FRP-weighted activity as a secondary metric, since FRP is less count-sensitive.
- Output both `count_raw` and `count_harmonized`, plus `method_version` and an uncertainty band (e.g., residual std from the overlap fit).
- Pick the method by held-out validation: fit on 2012–2018 overlap, test on 2019–2023. Report honestly where it fails (small regions, low counts, cloud/smoke-heavy areas).

### 2.4 Output data products (what the app reads)
Committed to `data/processed/` (or hosted release assets if too large):
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
docs/validation/       # plots + metrics
docs/data-notes.md     # verified facts about FIRMS data (Task 1.1)
docs/data-contract.md  # exact shape of the files the app reads (Task 2.0)
docs/CLAIMS.md         # who is working on what
web/                   # app source
web/fixtures/          # small fake sample files that follow the data contract
.env.example           # FIRMS_MAP_KEY=
```

## 6. Work breakdown and ownership
| # | Task | Owner | Depends on | Done when |
|---|------|-------|-----------|-----------|
| 1.1 | Verify sensor dates, columns, confidence mapping against FIRMS docs; write `docs/data-notes.md` | Yash (Codex) | — | Facts in this README confirmed/corrected |
| 1.2 | Download + clean pilot regions (01–03) | Yash (Codex) | 1.1 | Unified schema files exist, tests pass |
| 1.3 | Grid/dedupe + calibration experiments A/B/C (04–05) | Yash (Codex) | 1.2 | Metrics table comparing methods |
| 1.4 | Validation + aggregation outputs (06–07) | Yash (Codex) | 1.3 | Data products in 2.4 generated |
| 2.0 | Data contract + sample fixture files (Section 11.3) | Shrihan (Claude) + Yash review | — | `web/fixtures/` exists and Yash approved it |
| 2.1 | App scaffold, region + date selection, summary panel | Shrihan (Claude) | 2.0 | Works on fixture JSON |
| 2.2 | Calendar heatmap with 3 color modes | Shrihan (Claude) | 2.1 | Matches spec 3.1.4 |
| 2.3 | Charts, map, CSV export, methods page | Shrihan (Claude) | 2.1, 1.4 | Spec 3.1 complete |
| 3.1 | Integrate real data, current-fire comparison, polish, demo script | both | 1.4, 2.3 | End-to-end demo |

Before starting a row, add a line to `docs/CLAIMS.md` (format is in that file). One branch per task. The full step-by-step version of this table is the checklist in Section 10.

## 7. Risks and open questions
- Count mapping may vary by region/biome; a single global fit may be wrong → fit per region, report error.
- The VIIRS→MODIS-scale mapping is learned on the 2012+ overlap. It matters most for any period where MODIS data is missing or ends (Terra and Aqua are old satellites near end of life; verify their current status). Using it there assumes the relationship stays the same over time; document this assumption.
- Detection depends on overpass time, cloud, and smoke; harmonization does not fix undercounting from these.
- Data size for global per-detection export → shard by region-year.
- NRT vs. SP data differ; keep NRT separate and labeled.
- Licence/citation requirements for FIRMS data: verify and put in the README.

## 8. Definition of done
Pipeline reproduces from raw; validation report published; web app deployed; calendar, analytics, and CSV work for the pilot regions; methods page honest about uncertainty.

---

## 9. Team roles and responsibilities

Two people, two AI tools. Each person owns one half of the project and uses one AI.

| | **Shrihan** | **Yash** |
|---|---|---|
| AI tool | Claude (Claude Code) | Codex |
| Owns folder | `web/` (the website) | `pipeline/` and `data/` (the data work) |
| Main job | Build the web app: map, region picker, date picker, burning calendar, charts, CSV download, methods page | Download FIRMS data, clean it, harmonize MODIS + VIIRS, check the results, produce the files the app reads |
| Also owns | The data contract fixtures (`web/fixtures/`), keeping `README.md` checklist up to date, the demo | `docs/data-notes.md` (verified facts), `docs/validation/` (plots + numbers that prove harmonization works) |
| Reviews | Yash's pull requests (reads the plots, asks "does this make sense?") | Shrihan's pull requests (checks the app shows the data correctly) |
| Shared | Data analysis (Section 13), final demo, presentation | Same |

Rules for the split:
- You only edit files in your own folder. If you need a change in the other person's folder, ask them (or open an issue).
- Shared files (`README.md`, `docs/CLAIMS.md`, `CLAUDE.md`, `AGENTS.md`) can be edited by both, but keep each change small and in its own pull request so you do not overwrite each other.
- The only thing that connects the two halves is the data contract (Section 11.3). As long as both sides follow it, you can work at the same time without waiting for each other.

---

## 10. Step-by-step checklist

Tick a box (`- [x]`) in a pull request when the step is done. Owner is in brackets. Do the phases in order; steps inside a phase with different owners can happen at the same time.

### Phase 0 — Setup (both, day 1)
- [ ] [Both] Clone the repo and read this whole README once.
- [ ] [Both] Install Python 3.11+ and Node.js 20+ (LTS). Check with `python3 --version` and `node --version`.
- [ ] [Yash] Get a free FIRMS MAP_KEY (request page: https://firms.modaps.eosdis.nasa.gov/api/map_key/ — verify link). Put it in `.env` as `FIRMS_MAP_KEY=...`. Never commit `.env`.
- [ ] [Yash] Create `.env.example` with `FIRMS_MAP_KEY=` (empty) and commit it.
- [ ] [Both] Agree on the 4 pilot regions (default: California, Pará in Brazil, NSW/Victoria in Australia, Portugal). Write the final list in Section 2.1.
- [ ] [Both] Agree on daily sync time (Section 11.1).

### Phase 1 — Check the facts (Yash, with Codex)
- [ ] [Yash] Read the FIRMS documentation for MODIS C6.1 and VIIRS 375 m active fire products.
- [ ] [Yash] Write `docs/data-notes.md` with: start date of each satellite, exact CSV column names for each sensor, what each confidence value means, what `type` values mean, data licence and how to cite FIRMS.
- [ ] [Yash] Fix anything in this README that turned out wrong (Sections 0, 2.1, 7).
- [ ] [Shrihan] Review `docs/data-notes.md` and merge.

### Phase 2 — Data contract (Shrihan, with Claude; Yash reviews)
- [ ] [Shrihan] Write the JSON schema for each app file in Section 2.4 into `docs/data-contract.md`, starting from the example in Section 11.3.
- [ ] [Shrihan] Make small fake sample files in `web/fixtures/` (1 region, 3 years) that follow the schema exactly. Mark them clearly as fake (`"is_sample": true`).
- [ ] [Yash] Review: "Can my pipeline produce exactly this?" Change the contract now if not. After merge, changes to the contract need both people to agree.

### Phase 3 — Get and clean data (Yash, with Codex)
- [ ] [Yash] `pipeline/01_download.py`: download MODIS and VIIRS archive data for one pilot region and one year first. Check the file opens and has rows.
- [ ] [Yash] Extend to all pilot regions and all years (2000→now). Keep raw files in `data/raw/` (not committed).
- [ ] [Yash] `02_clean.py`: convert both sensors into the single schema in Section 2.2. Write a test that loads 5 known rows and checks the output.
- [ ] [Yash] `03_filter.py`: remove low-confidence and non-vegetation detections; print how many were removed per sensor per year.
- [ ] [Yash] Do the sanity checks in Section 13, Step A. Save the plots in `docs/validation/`.

### Phase 4 — Build the app on fake data (Shrihan, with Claude) — runs at the same time as Phases 3–5
- [ ] [Shrihan] Scaffold `web/` (Vite + TypeScript). Page loads with a blank map.
- [ ] [Shrihan] Region picker (dropdown + draw on map) and date range picker with presets.
- [ ] [Shrihan] Summary panel reading from `web/fixtures/`.
- [ ] [Shrihan] Burning activity calendar (years × months) with the 3 color modes, legend, tooltips, hatching for missing data.
- [ ] [Shrihan] Monthly time series, yearly totals, seasonal cycle charts.
- [ ] [Shrihan] CSV download of the current query (columns in Section 3.1.8).
- [ ] [Shrihan] Check the page works on a phone-sized screen and with keyboard only.

### Phase 5 — Harmonize (Yash, with Codex; analysis with Shrihan)
- [ ] [Yash] `04_dedupe_and_grid.py`: put detections on the grid; test that no detection is lost or counted twice.
- [ ] [Yash] `05_calibrate.py`: implement Candidate A first, then B and C (Section 2.3).
- [ ] [Both] Do the analysis in Section 13, Steps B–D. Decide which method wins. Write the decision and the numbers in `docs/validation/README.md`.
- [ ] [Yash] `06_aggregate.py`: write the real app files into `data/processed/`, following the data contract exactly.
- [ ] [Yash] `07_validate.py`: one command that re-creates all validation plots and the metrics table.

### Phase 6 — Connect real data (both)
- [ ] [Shrihan] Switch the app from `web/fixtures/` to `data/processed/`. Nothing else should need to change; if it does, the contract was broken — fix the contract or the pipeline, not the app.
- [ ] [Both] Do Section 13, Step E (does the calendar make sense?).
- [ ] [Shrihan] Map with hotspot points, current-fire comparison, methods page.
- [ ] [Shrihan] Deploy to GitHub Pages.

### Phase 7 — Finish (both)
- [ ] [Both] Run the whole pipeline from an empty `data/processed/` and check the app still works.
- [ ] [Both] Write the "known limits" list on the methods page.
- [ ] [Both] Write and rehearse a 3-minute demo: pick a region → show calendar → show worst year → compare a recent fire → download CSV.
- [ ] [Both] Confirm everything in Section 8 (Definition of done) is true.

---

## 11. How Shrihan and Yash work together

### 11.1 Daily routine
1. **Start of day (10 min call or chat):** each person says (a) what I finished, (b) what I do today, (c) what is blocking me. Write the answers as one line each in `docs/CLAIMS.md` if anything changed.
2. **Before you start coding:** `git checkout main` then `git pull`, then make a new branch.
3. **While working:** commit small, working pieces. Push at least once a day so the other person can see progress.
4. **End of day:** push your branch, open or update the pull request, tick the checklist boxes you finished.

### 11.2 Git workflow (same for both)
1. One task = one branch. Name: `task/<id>-<short-name>`, for example `task/2.2-calendar` or `task/1.2-clean`.
2. Open a pull request into `main` when the task is done.
3. The **other person** reads the pull request before it is merged. For Yash's pull requests Shrihan looks at the plots and numbers; for Shrihan's pull requests Yash opens the app and checks the numbers look right.
4. Merge only after the other person says OK. Never push directly to `main`.
5. If two pull requests change the same file, the second one to merge pulls `main` first and fixes the conflict.

### 11.3 The data contract (how the two halves connect)
The app never reads raw data. It only reads the files listed in Section 2.4. Their exact shape is written in `docs/data-contract.md`. Example of one region's monthly file:

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
- Changing the contract needs both people to agree, and both the fixtures and the pipeline are updated in the same week.

---

## 12. How to prompt the AIs

Shrihan uses Claude Code; Yash uses Codex. Both tools read their instruction file automatically (`CLAUDE.md` for Claude, `AGENTS.md` for Codex), so you do not need to re-explain the project every time. You do need to be specific about the task.

### 12.1 Rules for good prompts (both AIs)
1. **One task per prompt.** Give the task ID from Section 10 ("Do task 2.2"), not "build the app".
2. **Say what goes in and what comes out.** Name the input files and the exact output file and format.
3. **Say how you will check it.** "Done when the test passes", "done when the calendar shows 3 years from `web/fixtures/`".
4. **Say what not to touch.** "Only edit files in `web/`."
5. **Forbid fake data.** "Do not invent numbers. If data is missing, stop and tell me."
6. **Ask for proof.** "Show me the commands you ran and their output."
7. **Ask it to ask.** "If something is unclear, ask me before guessing."
8. **Small steps.** If the AI's answer is very long or changes many files, ask it to split the work.

### 12.2 Prompt template — Shrihan → Claude
```
Task: <ID and name from README Section 10, e.g. 2.2 Burning activity calendar>
Read first: README.md Sections 3.1.4 and 11.3, docs/data-contract.md
Input: web/fixtures/monthly_region.sample.json
Output: a calendar component in web/src/, shown on the main page
Must: 3 color modes (log count, percentile, anomaly), legend, tooltip with count/rank/anomaly,
      hatching for null months, keyboard accessible.
Only edit: web/
Do not: change the data contract, invent data, add a backend.
Done when: `npm run dev` shows the calendar for the sample region and `npm test` passes.
Show me: the commands you ran and their output, and a screenshot if you can.
If anything is unclear, ask me first.
```

### 12.3 Prompt template — Yash → Codex
```
Task: <ID and name from README Section 10, e.g. 1.2 Clean MODIS + VIIRS data>
Read first: AGENTS.md, README.md Section 2.2, docs/data-notes.md
Input: data/raw/<sensor>/<year>.csv
Output: data/interim/clean_<sensor>_<year>.parquet with columns exactly:
        lat, lon, date, time_utc, sensor, satellite, confidence_class, frp, daynight, type
Only edit: pipeline/ and tests under pipeline/tests/
Do not: hard-code facts not in docs/data-notes.md, download data in tests, invent rows.
Done when: `pytest pipeline/tests -k clean` passes and the script prints rows in/out per sensor.
Show me: the commands you ran and their output.
If a column is missing or different from docs/data-notes.md, stop and tell me.
```

### 12.4 Checking what the AI gave you (do this every time)
- [ ] Run it yourself. Do not trust "it works" without seeing it work.
- [ ] Read the diff. Does it only touch the files it was allowed to?
- [ ] Look for invented values: hard-coded counts, made-up dates, fake column names.
- [ ] Check one number by hand. Example: count the rows for one day in the raw CSV and compare with what the pipeline or app says.
- [ ] If it is wrong, tell the AI exactly what is wrong and paste the error, instead of asking it to "try again".

### 12.5 Handing work between the two AIs
The AIs do not talk to each other. They share information only through the repo. So:
- Write decisions down in files (`docs/data-notes.md`, `docs/data-contract.md`, `docs/validation/README.md`), not only in chat.
- When one person finishes something the other needs, say so in the daily sync and point to the file.

---

## 13. How to analyze the data (both, step by step)

Do these steps together, on a shared screen if possible. Yash runs the code; Shrihan asks questions and writes down the findings. Save every plot in `docs/validation/` with a clear file name.

### Step A — Sanity checks on cleaned data (after Phase 3)
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
1. Split the overlap years: **train** on 2012–2018, **test** on 2019–2023.
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

### Step E — Check the final calendar makes sense (after Phase 6)
1. Open the app for each pilot region.
2. Does the fire season in the calendar match Step A.2? It should.
3. Is there a jump in colour around 2012 that is not explained by a real event? If yes, harmonization is not working well enough — go back to Step C.
4. Look at the worst years in the calendar. Can you find a news report or published source about big fires in that region and year? Write down which years you could confirm and the source. Do not claim a confirmation you did not find.
5. Download the CSV for one month and check that its row count matches what the app shows.

### Step F — Write up what you found
For each region, write 3–5 short sentences on the methods page: peak months, most active years, any trend, and how sure we are (from the Step C numbers). Use plain words, because emergency managers will read it.
