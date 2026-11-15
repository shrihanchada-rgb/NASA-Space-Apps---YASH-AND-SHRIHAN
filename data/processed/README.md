# data/processed — the files the website reads (California)

Built by `python3 pipeline/06_aggregate.py` on 2026-11-15 from the filtered FIRMS detections. Real data (`"is_sample": false`). Checked with `python3 scripts/validate_data.py data/processed` → `0 problem(s)`.

Run the website on it: `cd web && DATA_DIR=../data/processed npm run dev`.

| File | Contents |
|---|---|
| `metadata.json` | method version `A1-1.0`, coverage 2000-11-01 → 2026-08-31, sources, filters, validation numbers, citation |
| `regions.geojson` | California outline (Natural Earth), 409,565 km² |
| `regions/US-CA/monthly.json` | 310 months: harmonized count, approximate range, raw MODIS and VIIRS counts, FRP |
| `regions/US-CA/daily.json` | 9,435 days: harmonized count, raw counts, FRP |
| `regions/US-CA/baseline.json` | per calendar month, 2001–2025: mean, standard deviation, percentiles (for anomaly and percentile colours) |
| `regions/US-CA/hotspots/<year>.csv` | every kept detection inside California (1,903,272 rows, 131 MB in total; 2020 is 35 MB) with its `harmonized_weight` |
| `regions/US-CA/grid_cells.csv` | extra: the 754 quarter-degree cells of California |
| `regions/US-CA/grid_monthly.csv` | extra: harmonized and raw counts per month and cell (44,704 rows) |
| `regions/US-CA/harmonization_check.json` | extra: observed MODIS next to MODIS-equivalent from S-NPP for the 139 months where Terra, Aqua and S-NPP all had data every day; the factors used |
| `regions/US-CA/satellite_outages.csv` | extra: the 64 periods when a satellite delivered no data, and the evidence |

## What `count_harm` is

MODIS-equivalent detections (Terra + Aqua scale), built day by day from two estimates:

| Estimate | How |
|---|---|
| MODIS estimate | Terra + Aqua detections. If only one of them has data that day, that one × a factor (Terra × 2.056, Aqua × 1.947). |
| VIIRS estimate | S-NPP detections × k, with k per calendar month (0.216–0.348 in California). |

- **Both exist** (most days from 20 Jan 2012 to 31 Jul 2026): `count_harm` = half of each. It is one estimate from two sensors, never their sum.
- **Only one exists:** that one. Before 2012 that is always MODIS.
- **Neither:** `null` (no data). This happens on 28 days: the Terra outages of 15 Jun – 2 Jul 2001 and 19–28 Mar 2002, before Aqua flew.

**Satellite outages are treated as missing data, not as "no fires".** `satellite_outages.csv` lists the 64 periods found (212 satellite-days in total). The long ones match known events: Terra in Jun 2001, Mar 2002, Dec 2003, Feb 2016 and Oct 2022; Aqua in Aug 2002 and Apr 2022; S-NPP from 27 Jul to 10 Aug 2022 and on 24–28 Jul 2024. `metadata.json` `known_gaps` lists those of 3 days or more.

`count_low`/`count_high` are an approximate range, not a confidence interval. They equal `count_harm` where it is purely observed Terra + Aqua.

To use the MODIS estimate alone wherever it exists, set `HARMONIZE_POLICY = "modis_first"` in `pipeline/config.py` and re-run step 06.

## Checks against double counting and errors

`python3 pipeline/06b_audit_processed.py` re-derives the numbers by a separate route and must print `All checks passed` (it did on 2026-11-15). It checks:
- **No detection twice:** no duplicate rows; every row in the file of its own year.
- **Nothing lost or added since gridding:** rows per satellite equal the S14 totals (T 150,541, A 145,653, S-NPP 878,086, NOAA-20 629,801, NOAA-21 99,191).
- **Weights follow the rules:** every row's weight is rebuilt from the service dates, the outage list, the factors and k, and equals the file (largest difference 0.000004).
- **One estimate, not two:** on days with both sensors the combined value lies between the two single-sensor estimates; in total it is 1.011 × the MODIS estimate.
- **Files agree:** monthly = sum of daily = sum of grid cells = sum of hotspot weights.
- **No jump in 2012:** harmonized ÷ MODIS estimate is exactly 1 for 2003–2011 and 0.95–1.05 for every year 2012–2025.
- **Baseline** matches statistics recomputed from `monthly.json`.

Not removed, on purpose: one fire seen by one satellite on two passes in a day, or in neighbouring pixels, is several detections. That is how FIRMS counts, and MODIS counts before 2012 include the same effect, so the scale stays comparable.

## Results for an area the user chooses

- **Exact:** take the rows of `hotspots/<year>.csv` inside the area. The sum of `harmonized_weight` is the area's harmonized count; the row count is the raw count. The same rows are the CSV download.
- **Fast (calendar, anomalies, charts):** sum `grid_monthly.csv` over the cells whose centre (`grid_cells.csv`) is inside the area. Resolution is 0.25° (about 25 km). An area baseline is the same statistics as `baseline.json`, computed from those sums for 2001–2025.
- NOAA-20 and NOAA-21 rows have weight 0: they are in the raw counts, the map and the downloads, but not in `count_harm`.

## Re-creating

Needs the 55 filtered California files in `data/interim/filtered/US-CA/` (on Drive under `interim/filtered/US-CA/`; each is under 10 MB). Then `python3 pipeline/06_aggregate.py` (about 30 seconds).
