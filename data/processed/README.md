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
| `regions/US-CA/harmonization_check.json` | extra: observed MODIS next to MODIS-equivalent from S-NPP, 174 overlap months |

## What `count_harm` is

MODIS-equivalent detections (Terra + Aqua scale), built day by day:
- **20 Jan 2012 – 31 Jul 2026 (MODIS and S-NPP both have data):** half observed MODIS + half S-NPP × k, with k per calendar month (0.216–0.348 in California).
- **4 Jul 2002 – 19 Jan 2012, and Aug 2026:** observed MODIS.
- **1 Nov 2000 – 3 Jul 2002 (Terra only):** Terra × 2.056.

`count_low`/`count_high` are an approximate range, not a confidence interval. They equal `count_harm` where it is purely observed MODIS.

To use observed MODIS alone wherever it exists, set `HARMONIZE_POLICY = "modis_first"` in `pipeline/config.py` and re-run step 06.

## Results for an area the user chooses

- **Exact:** take the rows of `hotspots/<year>.csv` inside the area. The sum of `harmonized_weight` is the area's harmonized count; the row count is the raw count. The same rows are the CSV download.
- **Fast (calendar, anomalies, charts):** sum `grid_monthly.csv` over the cells whose centre (`grid_cells.csv`) is inside the area. Resolution is 0.25° (about 25 km). An area baseline is the same statistics as `baseline.json`, computed from those sums for 2001–2025.
- NOAA-20 and NOAA-21 rows have weight 0: they are in the raw counts, the map and the downloads, but not in `count_harm`.

## Re-creating

Needs the 55 filtered California files in `data/interim/filtered/US-CA/` (on Drive under `interim/filtered/US-CA/`; each is under 10 MB). Then `python3 pipeline/06_aggregate.py` (about 30 seconds).
