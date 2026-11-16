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

### 2026-11-16 — Website made robust against failures; all branches confirmed in main — DONE (not a checklist step)
- **Who / AI:** Shrihan using Claude
- **Did:** Checked that every remote branch (37) is part of `main` (the earlier "unmerged" list came from a shallow clone). Hardened the website: one fetch helper with a 2-minute timeout and clear messages; each panel starts on its own and a failing panel (e.g. the map without WebGL) explains itself; a failing listener no longer stops the others; global error message; dates outside the data are clamped or refused; lower map point cap (100,000) on phones and small-memory devices.
- **Files changed:** `web/src/data/loader.ts`, `web/src/state.ts`, `web/src/main.ts`, `web/src/components/controls.ts`, `web/src/components/mapView.ts`, `web/src/data/robust.test.ts` (new), `web/README.md`, `docs/HANDOFF.md`
- **How to check it:** `cd web && npm run typecheck && npm test` → 48 passed; `npm run build`. `python3 -m pytest -q tests` → 52 passed.
- **Results / numbers:** Chromium fault tests: WebGL off → map panel says why, everything else works; `monthly.json` 500 and `metadata.json` unreachable → message at the top; hotspot month 503 → message under the map and in Downloads, calendar unaffected; start 1990 → moved to 2000-11-01 with a note; reversed dates and 2027 dates refused with a message; phone, Sep 2020 → density (277,285 > 100,000). No page errors in any case.
- **Decisions and why:** Timeout 2 minutes because the largest month file is about 20 MB. No retry loop: the user retries by changing the selection or reloading (failures are not cached).
- **Problems / open questions:** Not tested in Firefox/Safari or on a real phone. S29 still waits for GitHub Pages to be switched on.
- **Next step:** S29: Settings → Pages → Source "GitHub Actions", then re-run "Deploy website".

### 2026-11-16 — S29 Deploy (GitHub Pages) — BLOCKED (needs a repository setting)
- **Who / AI:** Shrihan using Claude
- **Did:** Added `.github/workflows/pages.yml` (merged in PR #33). On every push to `main` that changes `web/` or `data/processed/`, or by hand, it runs the web tests, builds the site with the real data, and deploys `web/dist` to GitHub Pages.
- **Files changed:** `.github/workflows/pages.yml`, `docs/HANDOFF.md`
- **How to check it:** Actions tab → "Deploy website": the `build` job passes. After Pages is switched on, rerun it; the site is at https://shrihanchada-rgb.github.io/NASA-Space-Apps---YASH-AND-SHRIHAN/
- **Results / numbers:** Run 43794665734: `build` succeeded; `deploy` failed with "Failed to create deployment (status: 404) … Ensure GitHub Pages has been enabled". Local check: built site (134 MB) served from a sub-folder loads the app and methods page with no console errors.
- **Decisions and why:** Deploy with GitHub Actions (no `gh-pages` branch, so the 131 MB data is not committed twice).
- **Problems / open questions:** Claude cannot change Pages settings (the session's GitHub proxy blocks that API). The repo is private: Pages on a private repo needs a paid GitHub plan (Pro), or the repo must be made public. A Pages site is public on the internet even when the repo is private.
- **Next step:** Shrihan: Settings → Pages → Source "GitHub Actions"; then Actions → Deploy website → Re-run all jobs. Then tick S29.

### 2026-11-16 — S25–S28 Real data, calendar check, map hotspots + comparison, Methods page — DONE
- **Who / AI:** Shrihan using Claude
- **Did:** The website now runs on the real California data by default (S25). Hotspot files are one per month (`hotspots/<YYYY-MM>.csv`), so the app loads only the months it needs; pipeline, fixtures, validator, audit, tests and contract §7 were updated together. The calendar was checked against Step E (S26). The map shows hotspots as points (coloured by sensor or FRP, click for details) for up to 93 days and 300,000 detections, otherwise as a density grid; a new "Compare with past years" panel ranks the chosen dates against the same dates in every other year and lists the 5 most similar episodes (S27). A Methods and limits page (`web/methods.html`) explains the method, validation, California write-up, limits, citation and licence (S28).
- **Files changed:** `pipeline/06_aggregate.py`, `pipeline/06b_audit_processed.py`, `scripts/make_sample_fixtures.py`, `scripts/validate_data.py`, `tests/`, `data/processed/` (rebuilt), `web/fixtures/` (rebuilt), `docs/data-contract.md`, `data/processed/README.md`, `web/vite.config.ts`, `web/index.html`, `web/methods.html` (new), `web/public/methods/US-CA_compare.png` (copy of `docs/validation/S16/`), `web/src/methods.ts` (new), `web/src/data/{loader,compare,compare.test,selection.test,types}.ts`, `web/src/components/{mapView,compare,summary,downloads,charts}.ts`, `web/src/main.ts`, `web/src/styles.css`, `web/README.md`, `docs/validation/S26/README.md` (new), `README.md`, `CLAUDE.md`, `AGENTS.md`.
- **How to check it:** `python3 -m pytest -q tests` → 52 passed. `python3 scripts/validate_data.py data/processed` and `... web/fixtures` → 0 problem(s). `python3 pipeline/06b_audit_processed.py` → All checks passed. `cd web && npm run typecheck && npm test` → 43 passed; `npm run build` builds `index.html` and `methods.html`. `npm run dev`, set dates 2020-09-01 to 2020-09-30: map shows 277,285 points; compare says 1st of 25.
- **Results / numbers:** Chromium on real data: app ready in about 1.8 s; Sep 2020 (largest month, 277,285 detections) points loaded in about 1.5 s; its hotspots CSV has 277,285 rows and weights summing to 26,632.25 = `count_harm`. Region compare for the Mendocino Complex dates (2018-07-27 to 2018-09-18): 12,339 hotspots, 3rd of 25. Area (-123.5, 38.75, -122.25, 39.75), Jul–Sep 2018: 3,988, 1st of 25. Phone (390 px): no sideways scroll. No console errors (light, dark, phone). S26: season, 2012, worst years (2020, 2021, 2008, 2018 confirmed with sources; 2017 not checked) and the one-month CSV all pass, details in `docs/validation/S26/README.md`.
- **Decisions and why:** Per-month hotspot files (the S25 "nothing else changed" test is therefore not strictly met: the file layout changed for speed, not the numbers). Drawn-area summary now comes from the grid (whole months), like the calendar, instead of loading every point. Point cap 300,000 after testing the largest month; above it, density. Comparison is by count in log terms; day precision for the region, whole months for drawn areas. No near-real-time data, so "current fire" means any chosen dates up to 2026-08-31; the panel says so.
- **Problems / open questions:** Headless Chromium draws 100,000+ points several seconds after loading (software rendering); the old layer is now cleared at once so nothing stale shows. Not tested in Firefox/Safari or on a real phone. In headless tests, the "Points" button stays pressed while density is shown for long ranges; the note under the map explains it.
- **Next step:** S29 deploy (GitHub Pages). `npm run build` copies all of `data/processed` (131 MB) into `dist/data`; check GitHub Pages size limits first.

### 2026-11-14 — Website design refresh + NASA satellite map — DONE (not a checklist step)
- **Who / AI:** Shrihan using Claude, with the `ui-ux-pro-max` design skill
- **Did:** Redesigned the website: app bar with data-status tags, KPI cards for the summary, flat Swiss-style look (no gradients), IBM Plex Sans + Mono (chosen after a web search to avoid "AI default" fonts such as Inter/Space Grotesk), dark mode, empty states for planned sections. Map now uses NASA GIBS imagery with a switcher: Satellite (Blue Marble), Imagery on date (MODIS Terra true colour for the selected end date, with coastlines), Plain; optional place names.
- **Files changed:** `web/index.html`, `web/src/styles.css`, `web/src/main.ts`, `web/src/icons.ts` (new), `web/src/components/{summary,mapView,placeholder,controls}.ts`, `web/package.json`, `web/package-lock.json`, `web/README.md`, `docs/sources.md`, `docs/HANDOFF.md`
- **How to check it:** `cd web && npm install && npm run typecheck && npm test` (20 pass) and `npm run build`; `npm run dev`, switch the three map buttons.
- **Results / numbers:** Chromium check at 1440 px, 390 px and dark mode: IBM Plex loads, 0 elements with gradients, no sideways scroll; 24/24 Blue Marble tiles for the California view returned HTTP 200. NASA's place-name (and occasionally coastline) tiles sometimes return HTTP 500, so place names default to off; failed overlay tiles are not logged as app errors.
- **Decisions and why:** NASA GIBS instead of Google Maps: Google needs an API key with billing and restricts use of its tiles in other map libraries; GIBS is free, NASA-made, and has imagery by date. The environment `nasa-space-apps-yash-and-shrihan` now allows `gibs.earthdata.nasa.gov` (for testing only; users' browsers load tiles directly).
- **Problems / open questions:** Daily imagery is often cloudy and has gaps between satellite passes (stated on the map). Not tested in Firefox/Safari. GIBS terms of use not re-read.
- **Next step:** S21 (calendar).

### 2026-11-14 — S20 Pickers and summary — DONE
- **Who / AI:** Shrihan using Claude (Yash's half: please review `web/README.md`)
- **Did:** Region search that filters the dropdown; click a region on the map to select it; "Draw an area" (drag a rectangle) with its own summary from hotspot points; date presets (All data, Last 30 days, Last 12 months, last full year, Fire season derived from the baseline); summary now shows peak month, peak year, % high-confidence and a collapsible raw-by-sensor section. Added a hotspot CSV loader (reusable for S23/S27).
- **Files changed:** `web/src/` (state, main, data/types, data/loader, data/derive, components/controls, components/summary, components/mapView, styles.css, new derive2.test.ts), `web/index.html`, `web/README.md`, `README.md`, `docs/HANDOFF.md`
- **How to check it:** `cd web && npm run typecheck && npm test` → 20 tests pass; `npm run build` succeeds; `npm run dev`, click "Fire season Jul–Sep 2025" → dates 2025-07-01 to 2025-09-30; click "Draw an area", drag on the map → summary switches to "Drawn area" with a "Clear drawn area" button.
- **Results / numbers:** Browser check (Chromium; desktop 1280, tablet 800, phone 390; dark mode): no console errors, no sideways scroll, sidebar no longer overflows (bug found and fixed in this step). Sample-data figures for all dates: 1,316 harmonized, peak month Aug 2025 (173), peak year 2025 (450), 30% high confidence, 30 days with no data.
- **Decisions and why:** Month-based figures use whole months overlapping the dates (labelled in the UI). Presets are relative to the end of the data, not today. Drawn areas are rectangles only (polygon drawing not built); their counts come from hotspot points, and they cannot show "days with no data".
- **Problems / open questions:** Clicking the map to switch regions is untested with more than one region (fixtures have one). Drawing has no keyboard alternative yet. Not tested in Firefox or Safari.
- **Next step:** S21 (calendar) on the website side; S10 downloads for BR-PA, AU-NSW-VIC, PT on the data side.

### 2026-11-14 — S19 Website scaffold — DONE
- **Who / AI:** Shrihan using Claude (this is Yash's half of the project; Yash should read `web/README.md`)
- **Did:** Built the website backbone in `web/` with Vite + TypeScript (no UI framework) and MapLibre. It loads the sample data in `web/fixtures/`, shows a "SAMPLE DATA" banner, a region dropdown, a date range, basic totals for the selection, and a map with the region outline. Calendar, charts and downloads are labelled placeholders. Wrote `web/README.md` (commands, structure, rules for adding a feature).
- **Files changed:** `web/` (package.json, package-lock.json, tsconfig.json, vite.config.ts, index.html, src/, README.md), `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/HANDOFF.md`
- **How to check it:** `cd web && npm install && npm run typecheck && npm test` (9 tests pass), `npm run build` (succeeds), `npm run dev` and open the address: banner, totals 1,316 harmonized / 636 MODIS / 2,718 VIIRS for the full sample range, map with an orange rectangle.
- **Results / numbers:** Checked in a real browser (Chromium, desktop 1280 px, phone 390 px, dark mode), dev server and built site: no console errors, no sideways scrolling. June 2024 (invented outage) shows "No data"; February 2023 (zero fires) shows 0; start date after end date shows an error message.
- **Decisions and why:** Plain TypeScript with a small state store instead of React, to keep it simple for two people and two AIs. Data folder is chosen by `DATA_DIR` in `vite.config.ts` (default fixtures), so real data needs no code change. Map has no basemap yet: no tile provider chosen (licence check pending, `docs/sources.md`). Versions installed: Vite 8, TypeScript 7, Vitest 5, MapLibre GL 6.
- **Problems / open questions:** The built JavaScript is about 1.07 MB (293 kB gzipped), almost all MapLibre; fine for now, could be loaded lazily later. Some S20 work is already present in basic form (dropdown, dates, totals), but S20 is not ticked. Not tested in Firefox or Safari.
- **Next step:** S20 (search, draw-on-map, date presets, fuller summary) or S21 (calendar). Pipeline side: S10 downloads for BR-PA, AU-NSW-VIC, PT are still to run.

### 2026-11-16 — S21–S24 Calendar, charts, downloads, phone/keyboard check — DONE
- **Who / AI:** Shrihan asked; Claude
- **Did:**
  - **Merged** S14–S17 into `main` (PR #30).
  - **Data set-up for the website:**
    - The area files (`grid_cells.csv`, `grid_monthly.csv`) are now a required part of the data contract (§8b, decided by Shrihan), checked by `scripts/validate_data.py` (they must add up to `monthly.json`).
    - Sample fixtures rebuilt: 2015–2025, California's real outline, fake points only inside it, grid files built with the pipeline's own code.
  - **S21:** burning activity calendar.
  - **S22:** charts.
  - **S23:** CSV downloads.
  - **S24:** phone and keyboard check, plus an "Enter an area by coordinates" form as the keyboard alternative to drawing.
  - **Selection:** the default is the whole of California. A drawn area (snapped to the 0.25° grid) changes the summary, calendar, charts and downloads to that area.
  - The site still uses the sample data by default, as asked.
- **Files changed:** `web/src/data/selection.ts`, `export.ts` (new), `web/src/components/calendar.ts`, `charts.ts`, `downloads.ts`, `tooltip.ts`, `scales.ts` (new), `placeholder.ts` (deleted), `web/src/main.ts`, `context.ts`, `data/loader.ts`, `data/types.ts`, `components/controls.ts`, `summary.ts`, `mapView.ts`, `web/src/styles.css`, `web/index.html`, `web/src/data/selection.test.ts` (new), `web/fixtures/*`, `web/README.md`, `scripts/make_sample_fixtures.py`, `scripts/validate_data.py`, `docs/data-contract.md`, `data/processed/README.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- **How to check it:**
  - `cd web && npm run typecheck && npm test` → 37 passed. `npm run build` succeeds.
  - `python3 -m pytest -q tests` → 52 passed. `python3 scripts/validate_data.py web/fixtures` and `data/processed` → 0 problems.
  - `npm run dev`: draw an area or use "Enter an area by coordinates"; the calendar subtitle says "Drawn area in California".
- **Results / numbers:**
  - Browser checks (Chromium): no console errors. The sample area (−123, 39.3, −120.6, 41.4) gave 90 cells and a harmonized total of 1,432; the downloaded CSV had 3,665 rows, 0 outside the box, weights summing to 1,432.25.
  - **Phone (iPhone 13, 390 px):** no sideways scrolling, every touch target ≥ 40 px (calendar cells 24.5 × 32 px), tapping a month selects it.
  - **Keyboard only:** Tab reaches every control; arrow keys move in the calendar; Enter selects a month; tooltips show on focus; charts readable with arrow keys.
  - Dark mode checked.
  - Real data (`DATA_DIR=../data/processed`): no errors, 324 calendar cells, a drawn area ready in about 2.5 s.
- **Decisions and why:**
  - **Snap drawn areas to whole 0.25° cells.** The calendar (from grid sums) and the CSV (from points) then always agree, and the calendar never needs the 131 MB of real hotspot files.
  - Discrete colour steps and an SVG hatch pattern (the user asked for no gradients).
  - The phone calendar hides the year-total column (the yearly chart shows it) to keep cells ≥ 24 px.
  - Hotspots CSV above 400,000 rows is offered as one file per year.
- **Problems / open questions:**
  - Drawn areas are rectangles only (no polygons).
  - The area's range is scaled from the region's, not computed for the area.
  - Not tested in Firefox or Safari, or with a real screen reader.
  - The JS bundle is 1.1 MB (mostly MapLibre).
- **Next step:** S25 (switch to real data) when the user says so; S27 hotspot points on the map.
- **If PAUSED — branch and resume command:** not paused.

### 2026-11-15 — Audit of the harmonized California data; satellite outages fixed — DONE
- **Who / AI:** Shrihan asked for double counting and errors to be ruled out; Claude
- **Did:**
  - Wrote `pipeline/06b_audit_processed.py`: 21 independent checks of `data/processed/` (duplicates, totals against S14, every row's weight, one-estimate-not-two, files agree, no jump in 2012, baseline).
  - The first run failed one check: 2024 harmonized was 12% below observed MODIS. Cause: S-NPP delivered no data on 24–28 Jul 2024 (and other days), and empty files were read as "no fires".
  - Fixed `06_aggregate.py`: it now finds satellite outages from `data/interim_extract/daily_counts.csv` and treats them as missing data. A single MODIS satellite is scaled when the other is out (Aqua-only factor 1.947 added). Rebuilt `data/processed/`.
- **Files changed:** `pipeline/06_aggregate.py`, `pipeline/06b_audit_processed.py` (new), `tests/test_clean_filter.py`, `data/processed/`, `data/processed/README.md`, `docs/data-contract.md`, `docs/validation/README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 pipeline/06b_audit_processed.py` → `All checks passed`. `python3 scripts/validate_data.py data/processed` → `0 problem(s)`. `python3 -m pytest -q tests` → `52 passed`.
- **Results / numbers:**
  - 64 outage periods (212 satellite-days): Terra 6, Aqua 2, S-NPP 37, NOAA-20 14, NOAA-21 5. The long ones match known outages.
  - Harmonized total 303,867.5 (was 301,327.0). July 2024: 4,596. 2024 harmonized ÷ MODIS estimate went from 0.88 to 1.02.
  - Harmonized ÷ MODIS estimate: exactly 1 for 2003–2011; 0.95–1.05 for 2012–2025; 1.11 for partial 2026.
  - No duplicate detections; rows per satellite equal the S14 totals.
- **Decisions and why:**
  - Outage rules. VIIRS: a day with zero cleaned detections in the download box (VIIRS sees static heat sources there every day), or S-NPP under 25% of NOAA-20 when NOAA-20 saw 40 or more. MODIS: 5 or more empty days in a row while the other MODIS satellite saw 20 or more (10 or more days in the Terra-only period). Stricter for MODIS because single empty winter days are normal.
  - Repeat views of one fire by one satellite are not removed: FIRMS counts them, and pre-2012 MODIS counts include them.
- **Problems / open questions:**
  - S15/S16 scores were computed before this fix and include outage errors (noted in `docs/validation/README.md`); not recomputed.
  - Short MODIS outages of under 5 days are not detected.
  - Outage detection for the archived regions was not done.
- **Next step:** S21 calendar on `data/processed/`.
- **If PAUSED — branch and resume command:** not paused.

### 2026-11-15 — Scope change to California only + S17 Aggregate — DONE
- **Who / AI:** Shrihan decided the scope; Claude did the work in the Claude session (no Colab)
- **Did:**
  - **Scope:** the product is California only. `ACTIVE_REGIONS = ["US-CA"]`; scripts default to it. Other regions' committed data moved to `archive/other_regions/` (README there). Validation docs keep all four regions.
  - **S17:** wrote `pipeline/06_aggregate.py` and built `data/processed/` for California: `metadata.json`, `regions.geojson`, `monthly.json`, `daily.json`, `baseline.json`, 27 hotspot CSVs with `harmonized_weight`, plus three extra files for user-chosen areas.
  - Downloaded the 55 filtered California files from Drive with the connector and re-ran step 04 here (same totals as Colab: 1,903,272 in-region detections).
  - Fixed `scripts/validate_data.py`: a null raw count now means "no rows of that sensor" (it wrongly compared null with 0).
- **Files changed:** `pipeline/06_aggregate.py` (new), `pipeline/config.py`, `pipeline/02`–`05` (default regions), `scripts/validate_data.py`, `tests/test_clean_filter.py`, `data/processed/` (new, 131 MB), `archive/other_regions/` (new), `data/interim_extract/`, `docs/data-contract.md` (§8b proposed additions), `docs/pipeline-files.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `51 passed`. `python3 scripts/validate_data.py data/processed` → `0 problem(s)`. `cd web && DATA_DIR=../data/processed npm run dev`: no sample banner, "Method A1-1.0", California total 301,327.
- **Results / numbers:**
  - 310 months, 9,435 days; harmonized total 301,327; peak month Sep 2020 (26,632); peak year 2020 (48,425).
  - Baseline 2001–2025: August mean 3,583, median 1,985.
  - 174 overlap months: S-NPP-converted ÷ observed MODIS = 1.004 overall.
  - Website loaded on the real files in Chromium with no console errors.
- **Decisions and why:**
  - **`blend` policy:** where MODIS and S-NPP both have data, `count_harm` is the average of observed MODIS and converted S-NPP. The user asked for MODIS and VIIRS to be harmonized together, and using both makes results for small chosen areas less noisy. Alternative `modis_first` is one setting.
  - NOAA-20/21 rows get weight 0 (kept for raw counts, map, downloads), so the changing number of VIIRS satellites cannot cause jumps.
  - Extra grid files are a proposed contract addition; contract 1.0 files are unchanged.
- **Problems / open questions:**
  - Hotspot files are large (131 MB; 2020 is 35 MB). The website must not load them all at once.
  - The blend changes how the number is made at 20 Jan 2012 (bias on test years 1.03, so the step should be about 1–2%; not measured separately).
  - Yash has not seen the scope change or §8b yet.
  - Website features (calendar, charts, downloads, points) are still to build: S21–S23, S27.
- **Next step:** S21 calendar on `data/processed/`.
- **If PAUSED — branch and resume command:** not paused.

### 2026-11-15 — S14–S16 Grid, calibrate, compare — DONE
- **Who / AI:** Shrihan ran Colab step 04 (434 s); Claude wrote the code, downloaded the grid files from Drive, and ran S15 and S16 in the Claude session
- **Did:**
  - S14: clipped and gridded all regions in Colab (all `[OK]`).
  - S15: `pipeline/05_calibrate.py` fits six candidate methods (A0, A1, A2, B0, B1, C) on 2014–2018.
  - S16: `pipeline/05b_compare_methods.py` scores them on 2019–2023, chooses one, sets an uncertainty band, and plots. Summary in `docs/validation/README.md`.
  - Quality run-through of the gridded data before fitting: all checks passed.
- **Files changed:** `pipeline/05_calibrate.py` (new), `pipeline/05b_compare_methods.py` (new), `pipeline/04_dedupe_and_grid.py`, `tests/test_clean_filter.py`, `docs/validation/README.md` (new), `docs/validation/S16/` (new), `data/interim_extract/grid/` (new), `data/interim_extract/README.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `49 passed`. `python3 pipeline/05_calibrate.py && python3 pipeline/05b_compare_methods.py` reproduces `docs/validation/S16/` from the committed grid copy.
- **Results / numbers:**
  - Clipping: outside the real outline were 8.9% (US-CA), 32.8% (BR-PA), 6.8% (AU-NSW-VIC) and 27.2% (PT) of filtered rows; 13,080,990 detections gridded.
  - **Chosen: A1 (ratio per calendar month), `A1-1.0`.** Test R² 0.992 / 0.984 / 0.993 / 0.906 and typical error 11.8 / 10.1 / 12.8 / 22.0% for US-CA / BR-PA / AU-NSW-VIC / PT.
  - Band coverage on test months: 78 / 67 / 58 / 80% (target 80%).
- **Decisions and why:**
  - S-NPP alone represents VIIRS (satellite count changes otherwise fake jumps).
  - Choice rule fixed before looking: lowest typical error in most regions, ties to the simpler method.
  - Band from leave-one-year-out train errors; in-sample errors were too optimistic.
  - S15/S16 could not run fully in the Claude session from raw files (10 MB Drive connector limit), so step 04 ran in Colab and its small monthly output was downloaded.
- **Problems / open questions:**
  - PT is weakest (bias 0.87). Error grows after 2023 (13–28%).
  - Band too narrow in BR-PA and AU-NSW-VIC.
  - NOAA-20/21 as S-NPP replacements are only checked by yearly ratios.
  - Whether `count_harm` should be observed MODIS where it exists is not yet decided with the user.
  - PT N20/N21 cell-level grid files were not copied into the repo.
- **Next step:** S17 Aggregate (see "Next pipeline step" in `AGENTS.md`/`CLAUDE.md`). Website: S21 calendar.
- **If PAUSED — branch and resume command:** not paused.

### 2026-11-15 — S14–S16 Grid, calibrate, compare — PAUSED (S14 code done; waiting for one Colab run of step 04)
- **Who / AI:** Shrihan using Claude
- **Did:** Wrote `pipeline/04_dedupe_and_grid.py` (S14): clips filtered detections to the real region outlines (`data/boundaries/regions_ne.geojson`, Natural Earth) and counts them per day / month, 0.25° cell and satellite, with a ~1 km de-duplicated count (`n_px1km`, also Candidate B's input). 3 new tests (45 pass). Smoke-tested on the real 200-row samples.
- **Files changed:** `pipeline/04_dedupe_and_grid.py` (new), `pipeline/config.py`, `scripts/make_region_boundaries.py` (new), `data/boundaries/regions_ne.geojson` (new), `tests/test_clean_filter.py`, `docs/pipeline-files.md`, `docs/sources.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `45 passed`.
- **Results / numbers:** none on full data yet. On the samples, 8–10% of rows fall outside the real outline in US-CA and AU-NSW-VIC, about 36% in BR-PA and 29% in PT (rectangular boxes include neighbours and sea).
- **Decisions and why:**
  - Tried to run everything in the Claude session instead of Colab: not possible, because the Drive connector refuses files over 10 MB and 7 filtered year files are larger. So step 04 runs once in Colab; its monthly grid files are small, and S15–S16 then run in the Claude session.
  - AU-NSW-VIC includes ACT and Jervis Bay (enclaves in NSW). Lord Howe Island is outside the download box.
- **Problems / open questions:** Natural Earth terms page still not read (docs/sources.md).
- **Next step:** Shrihan: fresh `repo.zip` of branch `step/S14-S16-grid-harmonize`, Colab `STEPS = ["04"]`, paste output. Claude: download `interim/grid/monthly/*.parquet` and `region_monthly.csv` from Drive, write and run `05_calibrate.py` (S15) and the comparison (S16).
- **If PAUSED — branch and resume command:** branch `step/S14-S16-grid-harmonize`; Colab `STEPS = ["04"]`, `STEP_ARGS = {}`.

### 2026-11-15 — Interim data extract filled — DONE
- **Who / AI:** Shrihan ran Colab `STEPS = ["03c"]` (493 s); Claude copied Drive `interim/extract/` into `data/interim_extract/` with the Drive connector and checked it
- **Did:** Committed `daily_counts.csv` (91,044 rows), `coverage.csv`, `MANIFEST.json` and 16 sample files (200 rows each). 5.2 MB in total.
- **Files changed:** `data/interim_extract/*`, `docs/HANDOFF.md`
- **How to check it:** `python3 -c "import pandas as pd; d=pd.read_csv('data/interim_extract/daily_counts.csv'); print(len(d), d.n_clean.sum(), d.n_kept.sum())"` → `91044 18888356 17385676`.
- **Results / numbers:**
  - Totals per region and source equal the S13 `clean_summary.csv` / `filter_counts.csv`.
  - Monthly counts per satellite equal the S13 `monthly_counts.csv`.
  - No missing download days.
- **Decisions and why:** none new.
- **Problems / open questions:** none.
- **Next step:** S14 (data) or S21 calendar (website). Both can now use `data/interim_extract/` ("use interim data").
- **If PAUSED — branch and resume command:** not paused.

### 2026-11-15 — Interim data extract + "use interim data" instructions — PAUSED (waiting for Colab `03c` run)
- **Who / AI:** Shrihan asked; Claude
- **Did:**
  - Added `pipeline/03c_interim_extract.py`, which writes a small, committable extract of the cleaned and filtered data (daily counts per satellite, download coverage, 200-row real samples, manifest).
  - Added the folder `data/interim_extract/` with a README. It holds this extract.
  - Added a "Using the interim data" section to `AGENTS.md`/`CLAUDE.md`: what "use interim data" means, where the files are, and the rules for interpreting them (including all S13 findings).
- **Files changed:** `pipeline/03c_interim_extract.py` (new), `tests/test_clean_filter.py`, `data/interim_extract/README.md` (new), `AGENTS.md`, `CLAUDE.md`, `docs/pipeline-files.md`, `README.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `42 passed`.
- **Results / numbers:** none yet. The extract files exist only after the Colab run.
- **Decisions and why:**
  - Only a small extract goes into git. The full interim parquet (about 19 M rows) stays on Drive: too big for the repo, and Codex can read the extract.
  - Daily counts keep only days with detections, plus `coverage.csv`, so "0 observed" and "no data" can be told apart.
- **Problems / open questions:** none.
- **Next step:** Shrihan uploads a fresh `repo.zip` of `main` and runs Colab `STEPS = ["03c"]`. Claude then copies Drive `interim/extract/` into `data/interim_extract/`.
- **If PAUSED — branch and resume command:** on `main`; Colab `STEPS = ["03c"]`, `STEP_ARGS = {}`.

### 2026-11-15 — S13 follow-up: three oddities checked — DONE (not a checklist step)
- **Who / AI:** Shrihan asked; Claude downloaded sample cleaned files from Drive and analysed them; web search for NASA MODIS outage notices
- **Did:** Checked the AU April peak, the AU Aqua/Terra ratio, and the PT MODIS Dec 2025 – Jan 2026 zeros. Results added to `docs/validation/S13/README.md` (follow-up section) and `docs/data-notes.md`.
- **Files changed:** `docs/validation/S13/README.md`, `docs/data-notes.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- **How to check it:** read the follow-up section. The numbers come from `docs/validation/S13/monthly_counts.csv` plus parquet files from Drive `interim/clean/AU-NSW-VIC/MODIS_SP/` (10 years) and `interim/clean/PT/*/2024–2026`.
- **Results / numbers:**
  - AU April: 2.9% in the Queensland strip, median FRP 22 MW, 4% at night, Aqua/Terra 5.7.
  - AU yearly Aqua/Terra correlates 0.80 with the autumn share.
  - PT Dec–Jan: 0 MODIS against about 6–20 expected. No NASA notice found.
- **Decisions and why:** proposed treating PT MODIS Dec 2025 and Jan 2026 as `null` plus `known_gaps` (to be applied in S17).
- **Problems / open questions:** neither the AU planned-burning explanation nor the PT archive gap is confirmed by an official source.
- **Next step:** S14.

### 2026-11-15 — S11–S13 Clean, filter, sanity checks — DONE
- **Who / AI:** Shrihan ran Colab (`STEPS = ["02", "03", "03b"]`, zip of branch `step/S11-S13-clean-filter-checks`); Claude wrote the code, copied the results from Drive and wrote the readings
- **Did:** All 18,888,356 raw rows were cleaned into one schema, filtered, and checked. The reports and plots were copied from Drive into `docs/validation/S13/`, with the readings in `docs/validation/S13/README.md`. S12 and S13 ticked.
- **Files changed:** `docs/validation/S13/` (new: README, 8 plots, 9 tables), `docs/data-notes.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `41 passed`. Open `docs/validation/S13/*.png`. Re-create in Colab with `STEPS = ["02", "03", "03b"]` (02 takes about 19 min, 03 about 2 min, 03b about 1 min).
- **Results / numbers:**
  - All 16 clean lines were `[OK]`. Duplicates dropped only in US-CA (8,438 / 38,691 / 39,541, equal to the S09 test rows).
  - MODIS version is `6.03` up to 2022-12-31, then `61.03`.
  - Filter removed 5.3–14.2% per region and sensor (never above 50%).
  - Peak months: US-CA Aug, BR-PA Sep, AU-NSW-VIC Apr and Dec–Jan, PT Aug.
  - No missing downloads. PT MODIS has 0 rows in Dec 2025 – Jan 2026 (FIRMS sent header-only files).
- **Decisions and why:**
  - The suspicious-zero threshold is 100 detections from the other sensor. VIIRS sees about 3–13 times more than MODIS, so smaller numbers are not evidence of a gap.
- **Problems / open questions:**
  - The AU April peak is unexplained (planned burning, or the Queensland strip in the box?).
  - The AU Aqua/Terra ratio varies 1.3–5.7.
  - The PT Dec 2025 – Jan 2026 MODIS zeros are unexplained.
  - Big-fire years are not yet checked against sources (Step E).
  - Counts are still for the download boxes, not the real regions.
- **Next step:** S14 grid and dedupe. Use one VIIRS satellite against MODIS, and Terra and Aqua separately (see the S13 README, "What this means"). Website: S21 calendar.
- **If PAUSED — branch and resume command:** not paused.

### 2026-11-15 — S11–S13 Clean, filter, sanity checks — PAUSED (code done and tested; waiting for the Colab run)
- **Who / AI:** Shrihan using Claude
- **Did:** Wrote `pipeline/02_clean.py` (S11), `pipeline/03_filter.py` (S12), `pipeline/03b_sanity_checks.py` (S13, README Section 13 Step A) and `pipeline/common.py` (shared paths and the one cleaned schema). Documented the file layout, columns and double-counting rules in `docs/pipeline-files.md`. Tests use 5 real MODIS and 5 real VIIRS rows copied from the PT raw files in Drive, plus clearly marked synthetic edge cases. S11 ticked (its "done when" is the test); S12 and S13 need the real run.
- **Files changed:** `pipeline/common.py` (new), `pipeline/02_clean.py` (new), `pipeline/03_filter.py` (new), `pipeline/03b_sanity_checks.py` (new), `pipeline/config.py`, `tests/test_clean_filter.py` (new), `requirements.txt` (matplotlib), `docs/pipeline-files.md` (new), `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- **How to check it:** `python3 -m pytest -q tests` → `41 passed`.
- **Results / numbers:** No real-data results yet. A simulated 26-year run (random data, not real) went through all three steps and produced the plots and tables.
- **Decisions and why:**
  - Cleaning keeps all `type` values and confidence classes. Filtering removes non-vegetation `type` first, then low confidence, so each removed row is counted once. README 2.2 updated to match.
  - Exact duplicates are dropped in cleaning, and the number is reported.
  - Files are one parquet per region, source and year, by row date, so no row is in two files.
  - Default filter (`type` 0, confidence ≥ nominal) matches the data contract example.
  - Zero-detection months are flagged "suspicious" only when the other sensor saw ≥ 100 detections that month. VIIRS sees several times more than MODIS, so small counts are not evidence of a gap.
  - The S13 script is named `03b_...` so the Colab notebook can run it with `STEPS` without a notebook change.
- **Problems / open questions:**
  - Colab memory and run time on 18.9 M rows are not measured (processing is per region, source and year to keep memory small).
  - Data is still in the rectangular download boxes, so counts include neighbouring areas.
  - The same fire seen by several satellites is not merged (S14).
- **Next step:** Shrihan uploads a fresh `repo.zip` of branch `step/S11-S13-clean-filter-checks` (GitHub: switch to that branch, Code → Download ZIP) to Drive, runs Colab with `STEPS = ["02", "03", "03b"]`, and pastes the output. Then Claude copies `interim/reports/` and `interim/validation/` from Drive into `docs/validation/S13/`, writes the readings, ticks S12 and S13, and the user merges.
- **If PAUSED — branch and resume command:** branch `step/S11-S13-clean-filter-checks`; Colab `STEPS = ["02", "03", "03b"]`, `STEP_ARGS = {}`.

### 2026-11-15 — S10 Download everything — DONE (all 4 regions)
- **Who / AI:** Shrihan ran Colab; Claude recorded results
- **Did:** **PT fully downloaded** (all 4 sources, full ranges, finished `ok`). All four pilot regions are now downloaded. Results added to `docs/data-notes.md` §8; `AGENTS.md`/`CLAUDE.md` status updated; S10 ticked in README.
- **Files changed:** `docs/data-notes.md`, `docs/HANDOFF.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`
- **How to check it:** Claude confirmed via the Drive connector that `raw/<SOURCE>/PT/` folders exist for all 4 sources (file counts not listed; too many for the connector). To count files and rows, run the counting cell from the 2026-11-15 chat (also easy to rewrite: count `*.csv` and data lines per `raw/<SOURCE>/<REGION>/`). Expected files per region: 1,887 / 1,062 / 609 / 250 (US-CA has 73 extra in the first three, from S09).
- **Results / numbers:** PT rows: MODIS_SP 102,903; VIIRS_SNPP_SP 158,096; VIIRS_NOAA20_SP 78,298; VIIRS_NOAA21_SP 40,676 (total 379,973). All regions together: 18,888,356 rows before cleaning.
- **How to re-create the raw files** (they are not in git): in Colab, step 01 with `--check-availability --region <ID> --start 2000-11-01 --end 2026-08-31` for each of `US-CA`, `BR-PA`, `AU-NSW-VIC`, `PT` (README Section 14). FIRMS may by then offer later SP months; the end date above fixes the range used here.
- **Decisions and why:** none new.
- **Problems / open questions:** A first PT attempt saved its files to Colab's temporary disk because Drive was not mounted; they were lost and the mount then failed with `ValueError`. Fixed by deleting the runtime and running all again. The successful run had 4 FIRMS 11-minute limit waits (cause not verified). The notebook should refuse to download unless Drive is mounted (offered to the user, not done).
- **Next step:** S11 Clean (`pipeline/02_clean.py`; requirements in `AGENTS.md`/`CLAUDE.md`, "Project state and lessons so far"). Website: S21 (calendar).
- **If PAUSED — branch and resume command:** not paused.

### 2026-11-15 — S10 Download everything — PAUSED (US-CA, BR-PA, AU-NSW-VIC done; PT left)
- **Who / AI:** Shrihan ran Colab; Claude recorded results
- **Did:** **AU-NSW-VIC fully downloaded** (all 4 sources, full ranges, finished `ok`, no 11-minute waits, only short rate-limit pauses). Row counts and observations added to `docs/data-notes.md` §8.
- **Files changed:** `docs/data-notes.md`, `docs/HANDOFF.md`
- **How to check it:** in Drive, `raw/<SOURCE>/AU-NSW-VIC/` has 1,887 / 1,062 / 609 / 250 files for MODIS_SP / VIIRS_SNPP_SP / VIIRS_NOAA20_SP / VIIRS_NOAA21_SP.
- **Results / numbers:** AU-NSW-VIC rows: MODIS_SP 629,515; VIIRS_SNPP_SP 1,817,213; VIIRS_NOAA20_SP 1,223,995; VIIRS_NOAA21_SP 310,146 (total 3,980,869). Aqua/Terra ratio 1.86.
- **Decisions and why:** none new.
- **Problems / open questions:** the box includes strips of Queensland and South Australia until clipping.
- **Next step:** Colab step 01 for `PT` (`--check-availability --region PT --start 2000-11-01 --end 2026-08-31`), then tick S10.
- **If PAUSED — branch and resume command:** none; resume with `PT` in Colab.

### 2026-11-14 — S10 Download everything — PAUSED (US-CA and BR-PA done; 2 regions left)
- **Who / AI:** Shrihan ran Colab; Claude recorded results
- **Did:** **BR-PA fully downloaded** (all 4 sources, full ranges, finished `ok`, no 11-minute waits). US-CA was done earlier. Row counts and observations recorded in `docs/data-notes.md` §8.
- **Files changed:** `docs/data-notes.md`, `docs/HANDOFF.md`
- **How to check it:** in Drive, `raw/<SOURCE>/BR-PA/` has 1,887 / 1,062 / 609 / 250 files for MODIS_SP / VIIRS_SNPP_SP / VIIRS_NOAA20_SP / VIIRS_NOAA21_SP.
- **Results / numbers:** BR-PA rows: MODIS_SP 2,707,098; VIIRS_SNPP_SP 5,348,275; VIIRS_NOAA20_SP 2,857,121; VIIRS_NOAA21_SP 1,206,395 (total 12,118,889). Aqua/Terra ratio 1.84 (California ~0.94).
- **Decisions and why:** none new.
- **Problems / open questions:** Terra vs Aqua imbalance differs by region → S15 must treat them separately (see data-notes). BR-PA box covers neighbouring states until clipping. 12 million rows for one region: S11 should process files in chunks to fit Colab memory (not measured yet).
- **Next step:** Colab step 01 for `AU-NSW-VIC`, then `PT` (same `--start 2000-11-01 --end 2026-08-31`).
- **If PAUSED — branch and resume command:** none; resume with the next region in Colab.

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
