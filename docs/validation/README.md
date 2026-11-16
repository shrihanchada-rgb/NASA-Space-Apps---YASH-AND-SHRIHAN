# Validation: which harmonization method, and how good it is

Folders: `S13/` (sanity checks on cleaned data), `S16/` (method comparison: tables, plots, fitted numbers). This page is the summary (README Section 13, Steps B–D). Written 2026-11-15.

## The chosen method: A1, "ratio per calendar month" (`method_version` `A1-1.0`)

**MODIS-equivalent count = k × S-NPP VIIRS count**, where k is one number per region and calendar month (12 numbers per region), learned from 2014–2018. MODIS means Terra + Aqua together.

**Why A1:** it has the lowest typical error on the test years in 3 of 4 regions, and in the fourth (Portugal) the simple ratio A0 is only slightly better. The S-NPP/MODIS ratio changes with the season (S13 and the plots here), and A1 is the simplest method that follows that.

**What "S-NPP" means here:** the conversion uses one VIIRS satellite, S-NPP. The number of VIIRS satellites changed in 2018 and 2023, and summing them would create fake jumps.

## Test results (2019–2023, never used for fitting)

Trained on 2014–2018, per region; 60 test months per region. Counts are in-region, filtered, monthly totals.

| Region | Method | R² | R² (log) | Typical error % | Bias |
|---|---|---|---|---|---|
| US-CA | **A1 ratio per month** | **0.992** | 0.976 | **11.8** | 1.033 |
| | A0 ratio | 0.974 | 0.945 | 21.7 | 1.068 |
| | B0 1 km + ratio | 0.983 | 0.945 | 20.4 | 0.979 |
| | B1 1 km + ratio per month | 0.978 | 0.962 | 13.6 | 0.956 |
| | C quantile mapping | 0.965 | 0.977 | 12.7 | 1.113 |
| | A2 power law per cell | 0.769 | 0.742 | 67.2 | 0.822 |
| BR-PA | **A1** | 0.984 | 0.988 | **10.1** | 1.016 |
| | A0 | 0.986 | 0.988 | 10.8 | 1.008 |
| | B0 | 0.978 | 0.989 | 14.1 | 0.976 |
| | B1 | 0.985 | 0.987 | 12.9 | 0.999 |
| | C | 0.985 | 0.985 | 12.6 | 0.998 |
| | A2 | 0.957 | 0.951 | 29.4 | 0.979 |
| AU-NSW-VIC | **A1** | **0.993** | 0.974 | **12.8** | 1.030 |
| | A0 | 0.937 | 0.963 | 20.0 | 1.147 |
| | B0 | 0.929 | 0.944 | 18.9 | 0.861 |
| | B1 | 0.885 | 0.956 | 17.9 | 0.839 |
| | C | 0.824 | 0.942 | 19.1 | 1.239 |
| | A2 | 0.384 | 0.766 | 43.3 | 0.591 |
| PT | **A1** | 0.906 | 0.935 | 22.0 | 0.870 |
| | A0 | 0.887 | 0.930 | **18.0** | 0.878 |
| | B0 | 0.811 | 0.815 | 32.5 | 1.019 |
| | B1 | 0.910 | 0.899 | 20.4 | 0.895 |
| | C | 0.881 | 0.928 | 19.0 | 0.864 |
| | A2 | 0.752 | 0.550 | 95.6 | 1.254 |

- **R²:** 1 − Σ(real − predicted)² / Σ(real − mean)², on monthly counts. **R² (log)** is the same on log(1 + count), so small months count too.
- **Typical error:** median of |predicted − real| / real, months with real ≥ 10 only.
- **Bias:** Σ predicted / Σ real (1.0 = none).
- Full table: `S16/metrics.csv`. Fitted numbers: `S16/params.json`. Every month's real and predicted values: `S16/region_month.csv`.

**Against the project's target (O2: R² ≥ 0.8):** A1 passes in all four regions (0.906–0.993).

## The uncertainty band

For each region, the band is `prediction × low … prediction × high`. It is meant to hold 80% of months. It is taken from train years only, with each train year predicted from the other four.

| Region | low × | high × | Test months really inside |
|---|---|---|---|
| US-CA | 0.812 | 1.319 | 78% |
| BR-PA | 0.764 | 1.185 | 67% |
| AU-NSW-VIC | 0.847 | 1.158 | 58% |
| PT | 0.682 | 1.543 | 80% |

**The band is too narrow in BR-PA and AU-NSW-VIC** (67% and 58% instead of 80%). Say "approximate range" in the app, not "confidence interval".

## Where it works badly

1. **Small months.** Typical error by size of the real monthly count:
   - BR-PA: 4.6% for months ≥ 1,000, against 20.9% for months of 10–99.
   - AU-NSW-VIC: 8.3% for months ≥ 1,000, against 52.6% for months of 10–99 (only 3 such months).
   - PT: 14.1% for months of 100–999, against 25.8% for months of 10–99.
   - PT has few fires most of the year, which is why it scores worst.
2. **Portugal is biased low** (0.87): the conversion gives 13% fewer than MODIS over the test years, and 25% fewer in 2022.
3. **Single months can be far off.** Worst test months for A1:
   - AU-NSW-VIC April 2022: +100% (1,687 real).
   - US-CA April 2022: +75% (104 real).
   - PT May 2023: +131% (12 real).
   - BR-PA February 2019: −46% (108 real).
4. **After the test years (2024 – Jul 2026) the error is larger** in three regions:
   - typical error US-CA 20.3%, BR-PA 28.0%, PT 21.7%, AU-NSW-VIC 13.0%
   - bias 0.90, 0.91, 1.18 and 1.00 respectively
   - Possible reasons, not verified: Terra and Aqua orbit drift (NASA), or S-NPP's last years.
   - This matters most for the months where the app will rely on VIIRS alone.
5. **Before 2014** (Feb 2012 – 2013, also not used for fitting) it holds up: typical error 7.6–9.7%, bias 0.95–1.00.
6. **The method works on region totals.** It doesn't correct single grid cells: the cell-level power law (A2) was the worst method everywhere.
7. **Only four regions were tested.** k differs a lot between them (0.16 to 0.39), so these numbers can't be used for other places without refitting.

## Found after S16: satellite outages inside the test years (2026-11-15)

- **What was found.** While auditing the California product, days were found on which a satellite delivered no data: for example S-NPP from 27 Jul to 10 Aug 2022 and on 24–28 Jul 2024, and Terra from 9 to 23 Oct 2022. The S15/S16 fits and scores above treated those days as "no fires".
- **Effect on the scores.** The test scores in this page therefore include outage errors and are somewhat pessimistic (it explains California's low 2022 bias of 0.91). k was fitted on 2014–2018, where the only long outage is Terra's in Feb 2016, so k is little affected. The scores were not recomputed.
- **Effect on the product.** `pipeline/06_aggregate.py` now handles outages as missing data (`data/processed/README.md`). With that, harmonized ÷ MODIS estimate for California is 0.95–1.05 in every year 2012–2025.

## What the plots show (`S16/<REGION>_compare.png`, four panels each)

- **Top left, MODIS against S-NPP per month (log scales):** the points fall on a tight straight line in every region, over 2–3 orders of magnitude. A ratio is the right kind of conversion.
- **Top right, the ratio S-NPP ÷ MODIS over time, coloured by calendar month:** no long-term trend through 2023, but a spread of about ±30–40% that follows the calendar month (most clearly in AU-NSW-VIC). This is why A1 beats A0.
- **Bottom left, test years, real MODIS (black) and converted S-NPP (orange) with the band:** the converted line follows the real one through the peaks, including the 2019–20 Australian fires and California 2020–21.
- **Bottom right, predicted against real:** points sit on the 1:1 line, with more scatter below about 100 detections per month.

## Other candidates, briefly

- **B (collapse VIIRS to ~1 km boxes first):** physically appealing, but it wasn't better than plain ratios. The collapse removes 38–58% of VIIRS detections, and the rest still needs a region ratio.
- **C (quantile mapping):** close to A1 in BR-PA and US-CA, worse in AU-NSW-VIC (bias 1.24). It can't handle a month larger than any in the train years without an extra rule.
- **A2 (power law per grid cell):** summing a curved per-cell fit underestimates big-fire months (AU bias 0.59).

## Two related checks

**Terra alone → Terra + Aqua** (needed for Nov 2000 – Jun 2002, when only Terra flew). Fitted on 2003–2010, tested on 2011–2018. F0 = one factor per region; F1 = one factor per calendar month.

| Region | F0 typical error % / bias | F1 typical error % / bias | Use |
|---|---|---|---|
| US-CA | 8.6 / 1.02 | 7.4 / 1.03 | either (factor about 2.06) |
| BR-PA | 17.5 / 1.07 | 20.0 / 1.13 | F0 (factor about 3.37) |
| AU-NSW-VIC | 35.3 / 0.77 | 18.2 / 0.88 | F1 (season matters) |
| PT | 14.0 / 1.08 | 14.9 / 1.11 | F0 (factor about 2.22) |

The Terra-only months are less certain than the rest of the record, especially in AU-NSW-VIC and BR-PA. Mark them in the app.

**NOAA-20 and NOAA-21 against S-NPP** (`S16/viirs_satellite_ratios.csv`; needed because S-NPP ended on 2 Nov 2026):
- **NOAA-20 ÷ S-NPP** per year is 0.96–1.04 in BR-PA and AU-NSW-VIC (2018–2025), 0.97–1.08 in US-CA except 1.27 in 2024, and 0.94–1.15 in PT.
- **NOAA-21 ÷ S-NPP** per year (2023–2025) is 0.94–1.00 in BR-PA and AU-NSW-VIC, 0.99–1.24 in US-CA and 0.79–1.11 in PT.
- So NOAA-20 can stand in for S-NPP with about ±5–15% extra error in most region-years. This was not tested as a full train/test experiment.

## One command (S18)

`python3 pipeline/07_validate.py` re-runs steps 05 and 05b, checks that California's results equal the ones in `S16/`, and checks `data/processed/` (contract, audit, scores in `metadata.json`, forecast, and that the website uses only our data). Report: `S18/README.md`.

## How to re-create

```
python3 pipeline/05_calibrate.py          # fits all methods (uses data/interim/grid/monthly, or the copy in data/interim_extract/grid/)
python3 pipeline/05b_compare_methods.py   # scores, choice, plots
```
The step before (`04_dedupe_and_grid.py`) needs the filtered files on Drive and runs in Colab.
