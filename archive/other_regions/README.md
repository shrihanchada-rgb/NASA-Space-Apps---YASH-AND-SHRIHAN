# Archived regions (not part of the product)

On 2026-11-15 the project was narrowed to **California only**. The other three regions that were downloaded and analysed are kept here so the work is not lost and the 4-region harmonization test can be re-run.

| Region | Id |
|---|---|
| Pará, Brazil | `BR-PA` |
| New South Wales + Victoria, Australia | `AU-NSW-VIC` |
| Portugal (mainland) | `PT` |

## What is here

- `interim_extract/daily_counts.csv`, `coverage.csv`: daily counts and download coverage (same columns as `data/interim_extract/`).
- `interim_extract/samples/`: 200 real filtered detections per region and source.
- `interim_extract/grid/monthly/`, `grid/region_monthly.csv`, `grid/region_cells.csv`: the clipped, gridded monthly counts used for the harmonization test. PT N20 and N21 cell files were never copied.

## What is elsewhere

- **Full raw, cleaned, filtered and gridded files:** Shrihan's Google Drive, `My Drive/nasa-fire-calendar/` (`raw/`, `interim/`), under each region's folder. Nothing was deleted there.
- **Results that use these regions:** `docs/validation/S13/`, `docs/validation/S16/` and `docs/validation/README.md`. They stay where they are, because they are the evidence that the method works outside California.
- **Region definitions:** still in `pipeline/config.py` (`REGIONS`, listed in `ARCHIVED_REGIONS`) and `data/boundaries/regions_ne.geojson`.

## Re-running the 4-region test

```
python3 pipeline/05_calibrate.py --region US-CA --region BR-PA --region AU-NSW-VIC --region PT
python3 pipeline/05b_compare_methods.py
```
`05_calibrate.py` looks for grid files here automatically. To bring a region back into the product, add its id to `ACTIVE_REGIONS` and run steps 02–06 for it (its filtered files are on Drive).
