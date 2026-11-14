# Website (`web/`)

The fire-calendar website. Vite + TypeScript, no UI framework. It reads only the files defined in `docs/data-contract.md`.

**Design:** flat, Swiss-style dashboard (no gradients), one ember accent, light and dark themes from CSS variables in `src/styles.css`. Fonts: IBM Plex Sans (text) and IBM Plex Mono (dates, tags), OFL-1.1, bundled from npm (`@fontsource-variable/ibm-plex-sans`, `@fontsource/ibm-plex-mono`), so no font server is called. Design guidance came from the `ui-ux-pro-max` skill (`.claude/skills/`).

**Map imagery:** NASA GIBS (free, no key): Blue Marble composite (default), MODIS Terra true colour for the selected end date, or plain. Place-name overlay is optional and off by default because NASA's label tiles sometimes return HTTP 500.

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

- Default: `web/fixtures/` (fake sample data, shows a "SAMPLE DATA" banner).
- Real data: `DATA_DIR=../data/processed npm run dev` (or `npm run build`). No app code changes.

## Structure

```
index.html              page layout: one <section> per feature
src/main.ts             starts the app: loads data, creates state, mounts components
src/state.ts            shared state (region, dates, colour mode, drawn box, draw mode) with subscribe()
src/context.ts          what every component receives (metadata, regions, state, loaded data)
src/data/types.ts       TypeScript shapes of the data files (mirror of the data contract)
src/data/loader.ts      the only place that fetches files
src/data/derive.ts      pure calculations (range totals, peaks, presets, fire season, drawn areas); unit tested
src/dom.ts              small helpers to build elements and format numbers
src/icons.ts            small line icons (decorative, aria-hidden)
src/components/         one file per page section
  controls.ts           region + date range
  summary.ts            totals for the selection
  mapView.ts            MapLibre map: GIBS imagery, region outlines, click + draw
  placeholder.ts        labelled empty section for a feature not built yet
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
| Map | NASA GIBS satellite basemap (3 modes), region outlines, selection, drawn box | S27 adds hotspot points |
| Burning activity calendar | Placeholder | S21 |
| Charts | Placeholder | S22 |
| CSV download | Placeholder | S23 |
| Hotspot CSV loading | Built (`loadHotspots`), used for drawn areas | reused by S23 / S27 |

## How some numbers are defined

- **Fire season preset:** the 3 consecutive calendar months with the highest mean `count_harm` in `baseline.json` (can wrap the year end, e.g. Nov–Jan), applied to the last full year in the data.
- **Peak month / peak year / % high confidence:** use whole months that overlap the chosen dates (month files cannot be split into days). The summary says so when the dates cut a month.
- **Presets** are relative to the last date in the data, not today's date.
- **Drawn area:** counts hotspot points inside the rectangle from the regions it overlaps. Harmonized count = sum of `harmonized_weight`. Days with no data cannot be identified from points, so a drawn area shows no "days with no data" figure.
