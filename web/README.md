# Website (`web/`)

The fire-calendar website. Vite + TypeScript, no UI framework. It reads only the files defined in `docs/data-contract.md`.

**Design:** flat, Swiss-style dashboard (no gradients), one ember accent, light and dark themes from CSS variables in `src/styles.css`. Fonts: IBM Plex Sans (text) and IBM Plex Mono (dates, tags), OFL-1.1, bundled from npm (`@fontsource-variable/ibm-plex-sans`, `@fontsource/ibm-plex-mono`), so no font server is called. Design guidance came from the `ui-ux-pro-max` skill (`.claude/skills/`).

**Combined Califire site (branch `merge/califire-combined`, 2026-11-16).** Our features and data with the look of Yashneil's Califire site (github.com/yashneil75/califire, MIT, copyright Yashneil Gajjala and Shrihan Chada):

| Page | File | Feature | Data |
|---|---|---|---|
| Overview | `index.html` | selection, summary figures, charts | ours (`data/processed`) |
| Archive | `archive.html` | burning activity calendar (years × months, 3 colour modes) | ours |
| Map | `map.html` | points / density, draw an area, place names | ours |
| Compare | `compare.html` | compare with past years | ours |
| Latest | `public/latest/index.html` | his day-by-day month grid, day drawer, 7-day forecast | his daily index (different unit) |
| Download | `download.html` | our CSVs; a separate card links to his `latest/download.html` | each its own |
| Methodology | `methodology.html` | ours, with a separate section on the Latest data; his own text is `latest/methodology.html` | each its own |

- **Separate features stay separate.** His Latest pages are his files, copied unchanged into `public/latest/` (served as they are, not built), except: the menu, a one-line "separate dataset" note, and `fetchLatest` in his `app.js` / `download.js`, which first reads the newest data from https://yashneil75.github.io/califire/ (refreshed daily there) and falls back to the copy in `public/latest/data/` (snapshot of 2026-11-15). His CSS and ours share 9 class names (`.panel`, `.brand`, `.cal-grid`…), so they are never loaded on the same page.
- **Look:** our `src/styles.css` tokens use his palette, Inter / Inter Tight (Google Fonts), square corners, his top bar, page titles and footer; light only, like his site. `src/shell.ts` draws the menu and footer for our pages.
- **Selection between pages:** dates, drawn area and colour mode are kept in the address (`?start=…&end=…&area=w,s,e,n&colors=…`) and in the menu links (`src/shell.ts`). Invalid values are ignored; an area is cut to California and snapped to the grid.
- **Phones:** the selection panel is a folded "Dates and area" bar that shows the current choice.
- `methods.html` now redirects to `methodology.html`.

**Califire** is the site's name. **Map:** NASA GIBS Blue Marble composite (free, no key) or a plain background. The "imagery on date" background was removed (2026-11-16). Place names are drawn by the app from `public/map/ca-places.json` (41 California places from Natural Earth, public domain; bigger places first, smaller ones as you zoom in), on by default. NASA's label tiles were dropped: they often returned HTTP 500 and left black patches on the map.
**Map limits:** `renderWorldCopies: false`, minimum zoom 4, and panning is limited to California plus a margin (`applyViewLimits` in `mapView.ts`, computed from the map size so the whole state always fits). A drawn rectangle, and the coordinates form, are cut to California's bounding box (`clampBox`); a rectangle wholly outside is refused with a message. The button "Show all of California" (shown while an area is drawn) returns to the whole region.

## Commands (run inside `web/`)

| What | Command |
|---|---|
| Install packages (once) | `npm install` |
| Start the site for development | `npm run dev` then open the printed address |
| Check types | `npm run typecheck` |
| Run unit tests | `npm test` |
| Run one test file | `npx vitest run src/data/derive.test.ts` |
| Build the site into `web/dist/` | `npm run build` |
| Look at the built site | `npm run preview` |

## Where the data comes from

The app fetches everything from `<site>/data/`. `vite.config.ts` decides which folder that is:

- Default (since S25, 2026-11-16): `../data/processed/`, the real California data built by the pipeline.
- Sample data: `DATA_DIR=fixtures npm run dev` (fake counts, shows a "SAMPLE DATA" banner; California's real outline and the grid files, so drawn areas behave like on real data). Re-create with `python3 scripts/make_sample_fixtures.py`. Tests use the sample files.
- Hotspots are one file per month (`hotspots/<YYYY-MM>.csv`); the app loads only the months of the chosen dates.
- Pages: `index.html` (the app) and `methods.html` (Methods and limits, S28). Both are built.

## Structure

```
index.html              page layout: one <section> per feature
src/main.ts             starts the app: loads data, creates state, mounts components
src/state.ts            shared state (region, dates, colour mode, drawn box, draw mode) with subscribe()
src/context.ts          what every component receives (metadata, regions, state, loaded data)
src/data/types.ts       TypeScript shapes of the data files (mirror of the data contract)
src/data/loader.ts      the only place that fetches files
src/data/derive.ts      pure calculations (range totals, peaks, presets, fire season); unit tested
src/data/selection.ts   the current selection: whole region, or a drawn area snapped to the 0.25° grid; its monthly
                        series, baseline, anomaly/percentile/rank, hotspot filter; unit tested
src/data/export.ts      CSV text for downloads (header lines, hotspots, monthly, calendar); unit tested
src/dom.ts              small helpers to build elements and format numbers
src/icons.ts            small line icons (decorative, aria-hidden)
src/components/         one file per page section
  controls.ts           region + date range
  summary.ts            totals for the selection
  mapView.ts            MapLibre map: GIBS imagery, region outlines, click + draw
  calendar.ts           S21 burning activity calendar (3 colour modes, legend, tooltips, hatching, keyboard)
  charts.ts             S22 monthly series with range, yearly totals, seasonal cycle (SVG, tooltips, tables)
  downloads.ts          S23 CSV downloads of the current selection and dates
  tooltip.ts            the one floating tooltip
  scales.ts             calendar colour steps (CSS variables --seq-* and --div-*)
src/styles.css          all styles; colours are CSS variables with light and dark values
```

## Rules for adding a feature

1. One component per file in `src/components/`, exporting `mountX(el, ctx)`.
2. Components read `ctx.state` and `ctx.loaded`, and call `subscribe()` to re-render. They never call each other.
3. To change the selection, call `ctx.state.set({...})`. Everything else updates by itself.
4. Fetch only through `src/data/loader.ts`. Put calculations in `src/data/derive.ts` with a test.
5. `null` means "no data": show "No data" or hatching, never `0`.
6. Build text with `h()` / `textContent`, not `innerHTML`.
7. Use the CSS variables for colours so dark mode keeps working.

## What is built and what is not

| Section | Status | Checklist step |
|---|---|---|
| Sample-data banner, footer citation | Built | S19 |
| Region search + dropdown, click region on map, draw a rectangle | Built | S20 (polygon drawing not built) |
| Date presets (all, last 30 days, last 12 months, last full year, fire season) + custom range | Built | S20 |
| Summary: harmonized total, peak month, peak year, FRP, % high confidence, days with no data, raw by sensor | Built | S20 |
| Map | NASA GIBS satellite basemap (2 modes: Satellite, Plain), place names, region outlines, selection, drawn box; hotspots as points (by sensor or FRP, click for details) or density per 0.25° cell, with legend | S20, S27 |
| Burning activity calendar: years × months, log-count / percentile / anomaly colours, legend, tooltip (count, range, rank, percentile, anomaly, raw counts), hatching for no data, year totals, typical month, sensor-change dots, click a month to select it, arrow-key navigation | Built | S21 |
| Charts: monthly series with approximate range, yearly totals (partial years hatched), seasonal cycle with the selected year; tooltips, keyboard, "Show as table" | Built | S22 |
| Downloads: hotspots CSV (one file, or one per year above 400,000 rows), monthly series CSV, calendar CSV; `#` header lines with selection, dates, method, citation | Built | S23 |
| Area by coordinates (keyboard alternative to drawing) | Built | S24 |
| Phone (390 px) and keyboard-only check | Done 2026-11-16 | S24 |
| Compare with past years: chosen dates (≤ 366 days) against the same dates in every other year; rank, percentile, FRP, busiest day, bar per year, 5 most similar past episodes with "Show" | Built | S27 |
| Methods and limits page: method, validation numbers and plots, California write-up, known limits, citation and licence | Built | S28 |
| Real data by default | Done 2026-11-16 | S25 |

## What happens when something fails

- Every data file is fetched through `getText` in `src/data/loader.ts`: it gives up after 2 minutes, and every failure becomes a plain message naming the file. A missing hotspot month (404) means no detections. Failed files are not cached, so trying again works.
- Each panel starts on its own (`mountSafely` in `src/main.ts`). If one fails (for example the map, when the browser has no WebGL), that panel says why and the others keep working.
- A panel that throws while updating does not stop the others (`src/state.ts`). Unexpected errors show one message at the top of the page.
- Dates partly outside the data are moved to its edges, with a note; dates fully outside it, reversed or incomplete dates are refused with a message.
- Phones and devices with 4 GB of memory or less draw at most 100,000 map points (others 300,000); above that, the density grid.
- Tested by breaking things in Chromium (2026-11-16): WebGL off, `monthly.json` HTTP 500, `metadata.json` unreachable, a hotspot month HTTP 503, dates 1990 / reversed / 2027, phone with the largest month. Each gave a message and no page errors. Unit tests: `src/data/robust.test.ts`.

## How some numbers are defined

- **Fire season preset:** the 3 consecutive calendar months with the highest mean `count_harm` in `baseline.json` (can wrap the year end, e.g. Nov–Jan), applied to the last full year in the data.
- **Peak month / peak year / % high confidence:** use whole months that overlap the chosen dates (month files cannot be split into days). The summary says so when the dates cut a month.
- **Presets** are relative to the last date in the data, not today's date.
- **Default selection:** the whole region (California). Everything (summary, calendar, charts, downloads) follows the selection.
- **Drawn area:** the rectangle is snapped outward to whole 0.25° grid cells (`snapBox`). Calendar and charts sum `grid_monthly.csv` over the cells inside it; the summary and the hotspots CSV use the hotspot rows inside the same snapped box. Each point belongs to exactly one cell, so the numbers agree (tested on the sample files). A month with no data for the region is no data for the area. The area's range is the area value × the region's low/high ratio for that month. The area's baseline (for percentile and anomaly colours) is recomputed from the area's own months over the region's base period.
- **Drawn-area summary** (since S25): from the grid, whole months, like the calendar. The area's hotspots CSV still uses exact dates.
- **Map points or density:** points when the dates span ≤ 93 days and the months hold ≤ 300,000 detections (the largest month, Sep 2020, has 277,285 and drew in about 1.5 s); otherwise the density grid of harmonized counts over whole months. The note under the map says which is shown and why.
- **Compare with past years:** whole region from `daily.json` (day precision); drawn area from its monthly series (whole months). A year is left out if more than 10% of its days (months) have no data. "Most similar" = closest harmonized count in log terms. 29 Feb in other years becomes 1 Mar. Near-real-time data is not included.
- **Anomaly %** = (month − mean of that calendar month) ÷ mean × 100. **Percentile** = share of base-period years with a lower value for that calendar month. **Rank** = position among all years for that calendar month.
- **Count (log) colours:** 0 has its own step; the other 6 steps are equal on a log scale up to the largest month of the selection.
