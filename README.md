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
web/                   # app source
.env.example           # FIRMS_MAP_KEY=
```

## 6. Work breakdown and ownership
| # | Task | Owner | Depends on | Done when |
|---|------|-------|-----------|-----------|
| 1.1 | Verify sensor dates, columns, confidence mapping against FIRMS docs; write `docs/data-notes.md` | Yash | — | Facts in this README confirmed/corrected |
| 1.2 | Download + clean pilot regions (01–03) | Yash | 1.1 | Unified schema files exist, tests pass |
| 1.3 | Grid/dedupe + calibration experiments A/B/C (04–05) | Yash | 1.2 | Metrics table comparing methods |
| 1.4 | Validation + aggregation outputs (06–07) | Yash | 1.3 | Data products in 2.4 generated |
| 2.1 | App scaffold, region + date selection, summary panel | Shrihan | mock data | Works on fixture JSON |
| 2.2 | Calendar heatmap with 3 color modes | Shrihan | 2.1 | Matches spec 3.1.4 |
| 2.3 | Charts, map, CSV export, methods page | Shrihan | 2.1, 1.4 | Spec 3.1 complete |
| 3.1 | Integrate real data, current-fire comparison, polish, demo script | both | 1.4, 2.3 | End-to-end demo |
Codex AI: take any unblocked row; announce in a `docs/CLAIMS.md` line to avoid overlap, and work on a branch per task.
(Owner split is a suggestion — pipeline vs. web — adjust as you like.)

## 7. Risks and open questions
- Count mapping may vary by region/biome; a single global fit may be wrong → fit per region, report error.
- Pre-2012 VIIRS does not exist, so the VIIRS→MODIS-scale mapping is extrapolated in time for the VIIRS-era, and MODIS history is the anchor; document this.
- Detection depends on overpass time, cloud, and smoke; harmonization does not fix undercounting from these.
- Data size for global per-detection export → shard by region-year.
- NRT vs. SP data differ; keep NRT separate and labeled.
- Licence/citation requirements for FIRMS data: verify and put in the README.

## 8. Definition of done
Pipeline reproduces from raw; validation report published; web app deployed; calendar, analytics, and CSV work for the pilot regions; methods page honest about uncertainty.
