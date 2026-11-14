# Website (`web/`)

The fire-calendar website. Vite + TypeScript, no UI framework. It reads only the files defined in `docs/data-contract.md`.

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
src/state.ts            shared state (region, dates, colour mode) with subscribe()
src/context.ts          what every component receives (metadata, regions, state, loaded data)
src/data/types.ts       TypeScript shapes of the data files (mirror of the data contract)
src/data/loader.ts      the only place that fetches files
src/data/derive.ts      pure calculations (totals for a date range); unit tested
src/dom.ts              small helpers to build elements and format numbers
src/components/         one file per page section
  controls.ts           region + date range
  summary.ts            totals for the selection
  mapView.ts            MapLibre map with region outlines
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
| Region dropdown, date range, basic totals | Basic version built | S20 adds search, draw-on-map, presets, peak month/year |
| Map | Region outlines only, no basemap | S27 adds basemap + hotspot points |
| Burning activity calendar | Placeholder | S21 |
| Charts | Placeholder | S22 |
| CSV download | Placeholder | S23 |
| Hotspot CSV loading | Not built (no loader yet) | S23 / S27 |
