# S13 sanity checks — real data, all four pilot regions

**Run:** 2026-11-15, Shrihan in Colab, `STEPS = ["02", "03", "03b"]`, code from branch `step/S11-S13-clean-filter-checks`. Readings written by Claude from the files in this folder (copied from Drive `interim/validation/` and `interim/reports/`).

**What the counts are:**
- detections kept after filtering (`type` 0, confidence nominal or high)
- inside the rectangular **download box** (not yet clipped to the real region)
- **not harmonized**
- "VIIRS total" is the sum of the VIIRS satellites flying that year
- partial years (open markers in the plots): 2000 (MODIS from 1 Nov), 2002 (Aqua from July), 2012 (S-NPP from 20 Jan), 2018 (NOAA-20 from April), 2023 (NOAA-21 from March), 2026 (data ends 31 Aug MODIS / 31 Jul VIIRS)

Files: `<REGION>_yearly.png`, `<REGION>_monthly.png`, `yearly_counts.csv`, `monthly_counts.csv`, `gaps.csv`, `checks_summary.md` (generated text), `filter_counts.csv`, `filter_summary.csv`, `clean_summary.csv`, `clean_versions.csv`.

## Cleaning (S11) — checks passed

- **Rows match the download.** All 16 region–source lines ended `[OK]`: raw rows = rows read = kept + duplicates. Kept rows equal the S10 download totals exactly (18,888,356 in all).
- **Duplicates are exactly the S09 test overlap.** Dropped only in US-CA, and the numbers are exactly the S09 test-year row counts: MODIS 8,438, S-NPP 38,691, NOAA-20 39,541. Every other region had 0 duplicates. This confirms the de-duplication removes the overlap and nothing else.
- **No rows outside their file's date window** (0 everywhere), so no row was counted in two years.
- **MODIS version switch: `6.03` up to 2022-12-31, `61.03` from 2023-01-01, in all four regions.** The per-region first/last dates differ by a few days only where there were no fires. There is no visible step in the MODIS lines at 2022→2023 (e.g. US-CA 7,761 → 8,438 raw rows), consistent with the FIRMS FAQ statement that C6.1 did not change the fire algorithm.

## Filtering (S12) — no filter removed more than half

| Region | MODIS removed (type / low conf / total %) | VIIRS removed (type / low conf / total %) |
|---|---|---|
| US-CA | 2.3 / 5.8 / 8.1 | 9.4 / 4.8 / 14.2 |
| BR-PA | 0.5 / 5.3 / 5.8 | 0.5 / 6.8 / 7.3 |
| AU-NSW-VIC | 2.4 / 5.4 / 7.8 | 2.8 / 4.8 / 7.5 |
| PT | 1.2 / 4.1 / 5.3 | 7.9 / 5.1 / 12.9 |

- **Every region is well under the 50% warning level.** The highest single year is PT VIIRS 2014, at 38.9% of 4,349 rows.
- **In US-CA and PT, VIIRS loses more in quiet years.** For example, US-CA VIIRS lost 29.1% in 2019 and 34.5% in partial 2026, against 7.5% in 2020. This fits non-vegetation "static land source" detections (type 2), such as industrial sites, being roughly constant while fires vary. It's an expected pattern, not a bug. Per-year detail: `filter_counts.csv`.

## Plots: what each shows

**US-CA_yearly.png**
- **The lines show the expected pattern.** MODIS starts in 2000, and VIIRS is several times higher from 2012.
- **Terra and Aqua are almost equal** here: Aqua/Terra 0.90–1.25 a year.
- **The highest years are 2020, 2021, 2018 and 2008**, and MODIS and VIIRS rise and fall together (dip in 2019, peak in 2020). These match widely reported large California fire years, but I haven't checked them against a source yet; that's README Step E (S26).
- **The VIIRS total steps up in 2018 because NOAA-20 was added**, not because of more fire. See the S-NPP-only line.

**US-CA_monthly.png**
- **One clear fire season, July–October:** August 29.9% (MODIS) / 35.4% (VIIRS), then September.
- **Both sensors have the same shape.**

**BR-PA_yearly.png**
- **Aqua sees 1.4–2.7 times more than Terra in every year.** Plausibly, afternoon burning is more visible to Aqua's early-afternoon pass than to Terra's mid-morning pass; this is not verified. So the Terra-only months (Nov 2000 – Jun 2002) undercount here more than elsewhere.
- **The 2023–2024 VIIRS rise has two causes:**
  - NOAA-21 started in 2023, making three VIIRS satellites.
  - 2024 is also the highest MODIS year since 2010, so part of the rise is real fire activity.

**BR-PA_monthly.png**
- **Dry-season burning, August–November,** peaking in September.
- **Almost nothing in February–April.**
- **Both sensors agree.**

**AU-NSW-VIC_yearly.png**
- **2019 is by far the highest year for both sensors.** That is consistent with the 2019–20 bushfire season, which is not yet checked against a source.
- **The Aqua/Terra ratio jumps around a lot,** from 1.3 to 5.7 a year, and is higher in 2021–2024 (about 4) than before.
  - The cause is not known.
  - One possibility to check (unverified) is changes in Terra's orbit in recent years. This matters for S15.

**AU-NSW-VIC_monthly.png**
- **Two peaks:** December–January (summer) and **April** (17.8% MODIS, 15.0% VIIRS).
- The April peak is not explained yet. It could be autumn planned burning, or burning in the strip of southern Queensland that the download box includes; neither is verified. Clipping to the real NSW and Victoria border will show whether it remains.

**PT_yearly.png**
- **MODIS's highest years are 2005, 2003 and 2017; VIIRS's highest is 2025** (61,061). 2014 is the quietest year for both.
- **Terra and Aqua are almost equal** (Aqua/Terra 0.87–1.38).
- Not yet checked against a source: whether these years match known fire seasons, and how much of 2025 comes from the strip of Spain inside the box.

**PT_monthly.png**
- **A sharp August peak:** 39.5% MODIS, 37.3% VIIRS.
- **A smaller March peak** (about 6%), not yet explained.

## Gaps (Step A.3)

- **Missing downloads: none in any region.** Every day in each source's date range has a raw file.
- **Zero-detection satellite-months: only in PT** (10 rows in `gaps.csv`).
- **6 of them are "quiet" winter months**, where VIIRS also saw 0–46. They are probably real.
- **4 are flagged as suspicious:** Terra **and** Aqua both have 0 detections in **Dec 2025 and Jan 2026**, while VIIRS saw 161 and 121 (before filtering).
  - **I checked the raw files in Drive.** All 13 MODIS_SP/PT chunk files from 2025-12-05 to 2026-01-29 are 127 bytes, which is a header row only. So FIRMS returned no rows; the files aren't missing or broken.
  - **The other regions do have MODIS detections in those months.** In Dec 2025: AU-NSW-VIC 514 Aqua / 410 Terra, BR-PA 3,492 / 1,093, US-CA 114 / 60. So this is not a global MODIS outage.
  - **Whether it is a real quiet spell or a gap in the FIRMS archive is unknown.** In the other PT Decembers and Januaries of 2012–2025, MODIS saw a median of 33 kept detections a month (range 0–335, zero only once), with VIIRS at a median of 184. Until it is explained, S17 should not treat these two PT months as proven "observed zero".

## What this means for the next steps (S14–S16)

1. **Compare MODIS with one VIIRS satellite, not the VIIRS total.**
   - The VIIRS total / MODIS ratio steps up with each new satellite. US-CA: about 4 in 2013–2017, about 7–9 in 2018–2022, about 10–12 in 2023–2025.
   - S-NPP alone / MODIS is much steadier: BR-PA 3.9–4.4 (2013–2024), PT 2.5–3.9, US-CA 3.0–4.7, AU-NSW-VIC 3.7–5.6.
   - Harmonization must work per VIIRS satellite, or average over the satellites flying, or the calendar will show fake jumps in 2018 and 2023.
2. **Handle Terra and Aqua separately.** Their ratio differs by region (about 1 in US-CA/PT, about 2 in BR-PA, 1.3–5.7 in AU-NSW-VIC).
3. **Clip to the real region boundaries** before final numbers. This may change the AU April peak and the PT 2025 count.
4. **Flag the partial years and the PT Dec 2025 – Jan 2026 MODIS months** in `metadata.json` `known_gaps` if they stay unexplained.
5. **The ratios are steady enough to be encouraging,** but how well harmonization works is unknown until S16 measures it on 2019–2023.
