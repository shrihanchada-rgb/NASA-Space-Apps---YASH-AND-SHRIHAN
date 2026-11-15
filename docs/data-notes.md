# FIRMS data notes (verified facts)

Step S05. Every fact below was read from an official NASA page on **2026-11-14**, with the source linked. If a fact is not on this page, treat it as unverified. Items still open are listed at the end.

Sources used:
- **[FAQ]** FIRMS FAQ: https://www.earthdata.nasa.gov/data/tools/firms/faq
- **[ATTR]** Active fire data attributes for MODIS and VIIRS: https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs
- **[API]** FIRMS API, area endpoint: https://firms.modaps.eosdis.nasa.gov/api/area/
- **[AVAIL]** FIRMS API, data availability: https://firms.modaps.eosdis.nasa.gov/api/data_availability/
- **[MODIS-UG]** MODIS Collection 6 and 6.1 Active Fire Product User's Guide v1.0: https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf
- **[VIIRS-UG]** VIIRS Collection 2 375 m Active Fire User Guide v1.2 (June 2025): https://www.earthdata.nasa.gov/s3fs-public/2025-06/VIIRS_C2_AF-375m_User_Guide_1.2.pdf

---

## 1. Satellites and dates

| Sensor / satellite | Pixel size | Data in FIRMS | Source |
|---|---|---|---|
| MODIS Terra | ~1 km at nadir | 1 November 2000 → present | [FAQ] "MODIS Terra are available from 1 November 2000 to the present" |
| MODIS Aqua | ~1 km at nadir | July 2002 → present ([FAQ] elsewhere: "starting July 4, 2002") | [FAQ] |
| VIIRS S-NPP | ~375 m at nadir | 20 January 2012 → **2 November 2026 (ended)** | [FAQ] "VIIRS S-NPP data are available from 20 January 2012 to November 2, 2026" |
| VIIRS NOAA-20 | ~375 m at nadir | 1 April 2018 → present | [FAQ] |
| VIIRS NOAA-21 | ~375 m at nadir | 17 January 2024 → present | [FAQ] |

Important:
- **S-NPP has stopped.** [FAQ]: "Production and delivery of new FIRMS active fire data, imagery, and other datasets from the Suomi National Polar-orbiting Partnership (Suomi NPP) satellite ceased at 15:40 Universal Time (UTC) on November 2, 2026." Its archive (2012 → 2 Nov 2026) is still listed as a source (`VIIRS_SNPP_SP`) in [API] and [AVAIL]. From now on, VIIRS continuity comes from NOAA-20 and NOAA-21 only.
- **Known MODIS gaps** ([FAQ]): "April 15, 2001; June 15 to July 3, 2001; and March 19 to 28, 2002" (list "not limited to" these).
- **Early VIIRS quality** ([FAQ]): "Numerous bad scan episodes ... were found in the Level 1 input data during the initial 18-24 months of the time series", "dropped to virtually zero" after 2015 processing changes. So 2012–2013 VIIRS data are less reliable for calibration.
- **Pixel size** ([FAQ]): "For MODIS the pixel is approximately 1 km and for VIIRS the pixel is approximately 375 m." Pixels get larger toward the edge of the swath; `scan` and `track` give the actual size ([ATTR]).
- **Overpass times** ([FAQ]): Terra about 10:30 a.m./p.m., Aqua about 1:30 p.m./a.m. Mean Local Time; S-NPP 1:30 p.m./a.m.; "NOAA-21 is flying half an orbit, or 50 minutes, ahead of NOAA-20, with Suomi NPP between them."

## 2. FIRMS API (how we download)

From [API]:
- URL: `/api/area/csv/[MAP_KEY]/[SOURCE]/[AREA_COORDINATES]/[DAY_RANGE]/[DATE]`. With `DATE` it "Returns data for [DATE] .. [DATE + DAY_RANGE-1]".
- `AREA_COORDINATES`: `west,south,east,north` (or `world`).
- `DAY_RANGE`: **1 .. 5** days per call. (A third-party summary said 10; the official page says 5. Use 5.)
- `DATE`: `YYYY-MM-DD`.
- Limit: "MAP_KEY limit is 5000 transactions / 10-minute interval. Larger transactions may count as multiple requests (ex. requesting 7 days)."
- `SOURCE` values: `MODIS_NRT`, `MODIS_SP`, `VIIRS_SNPP_NRT`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_NRT`, `VIIRS_NOAA21_SP`, `LANDSAT_NRT` (US/Canada only).
- `_SP` = Standard Processing (science quality, what we use for history). `_NRT` = near real-time (for the "current fire" feature only).
- The MAP_KEY is requested from the "Get MAP_KEY" link on [API]. The direct page `https://firms.modaps.eosdis.nasa.gov/api/map_key/` did not load from this session (connection reset), so that exact URL is **not confirmed**. The [API] page also says keys are managed by logging in through `/download`.
- [AVAIL]: `/api/data_availability/csv/[MAP_KEY]/[SENSOR]` (or `ALL`) returns the date range available per source. **Run this first in S09** to get the exact `_SP` start and end dates; they may differ from the [FAQ] dates.

Download size estimate (our own arithmetic, not from NASA): one region, one source, 2000–2026 is about 9,500 days ÷ 5 = ~1,900 calls. Well under the limit if spread out, but the script must pause between calls and resume after failures.

## 3. Columns (FIRMS CSV)

From [ATTR] (the page describes NRT data; standard-processing CSVs are expected to match, but **confirm on the first real download in S09**):

**MODIS:** `latitude`, `longitude`, `brightness` (channel 21/22 brightness temperature, K), `scan`, `track` (actual pixel size), `acq_date`, `acq_time` (UTC), `satellite` (`A` = Aqua, `T` = Terra), `confidence` (0–100 %), `version`, `bright_t31` (channel 31 brightness temperature, K), `frp` (fire radiative power, MW), `type`, `daynight` (`D`/`N`).

**VIIRS 375 m:** `latitude`, `longitude` ("Center of nominal 375 m fire pixel"), `bright_ti4` (I-4 brightness temperature, K), `scan`, `track`, `acq_date`, `acq_time` (UTC), `satellite` (`N` = Suomi NPP, `N20` = NOAA-20, `N21` = NOAA-21), `confidence` (low / nominal / high), `version`, `bright_ti5` (I-5 brightness temperature, K), `frp` (MW), `daynight` (`D`/`N`).

Notes:
- [ATTR] lists the brightness columns as `Bright_ti4` / "Brightness (in web services)" and `Bright_ti5` / "Brightness_2 (in web services)". The exact header text in API CSVs must be checked on first download.
- `version` ([ATTR]): MODIS e.g. `6.1` = Collection 6.1 standard processing, `6.1NRT` = near real-time, with `RT`/`URT` suffixes for faster products. VIIRS: collection number with `NRT` suffix for near real-time, collection only for standard.
- Each detection is the **center of a flagged pixel**, not the fire's exact location ([FAQ]).

## 4. Confidence

- **MODIS** ([MODIS-UG] Table 11): confidence C in %; `0 ≤ C < 30` = low, `30 ≤ C < 80` = nominal, `80 ≤ C ≤ 100` = high.
- **VIIRS** ([ATTR], [VIIRS-UG]): already a class. Low (daytime: sun glint, temperature anomaly < 15 K in I4), nominal (strong > 15 K anomaly, no glint), high (saturated pixels). The VIIRS monthly product uses letters `L`/`N`/`H` ([VIIRS-UG] 3.2.2); the exact letters in FIRMS CSVs are to be confirmed in S09.
- Low-confidence VIIRS nighttime pixels in the South Atlantic Magnetic Anomaly region "have been removed from the NRT data distributed by FIRMS" ([ATTR]). Whether they are in `_SP` data is not stated: check in S09.
- Guidance ([FAQ], [MODIS-UG]): "Users requiring fewer false alarms may wish to retain only nominal- and high-confidence fire pixels". This supports our default of dropping low confidence.

## 5. `type` (hot spot type)

From [ATTR] and [VIIRS-UG]: `0` = presumed vegetation fire, `1` = active volcano, `2` = other static land source, `3` = offshore (VIIRS-UG: "includes all detections over water").

- [ATTR] says for MODIS: "This attribute is only available for MCD14ML (standard quality) data", so **`type` is missing from NRT** data. It should be present in `MODIS_SP`; confirm in S09.
- For VIIRS, [ATTR] does not list `type` in the NRT table, but the VIIRS standard monthly product has it ([VIIRS-UG]). Confirm it is in `VIIRS_*_SP` CSVs in S09.

## 6. Collections

[FAQ]: "Collection 6.1 has been available since April 2021 and is the latest collection available. In terms of fire detections, there are no algorithm changes" vs Collection 6 (calibration changes only). The VIIRS user guide is for Collection 2.

## 7. Citation and use

[FAQ]:
- "NASA promotes full and open sharing of data and we encourage publication of imagery from FIRMS; when doing so for image captions, please cite it as "NASA FIRMS"".
- For scientific acknowledgment: "We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS)." The FAQ also says to read the LANCE Disclaimer (not read yet).
- VIIRS algorithm reference ([FAQ]): Schroeder, W., Oliva, P., Giglio, L., & Csiszar, I. A. (2014). The New VIIRS 375m active fire detection data product: algorithm description and initial assessment. Remote Sensing of Environment, 143: 85-96. doi:10.1016/j.rse.2013.12.008

The app's methods page and CSV header should include the "NASA FIRMS" citation line above.

## 8. Confirmed on the first real download (S09, 2026-11-14)

Shrihan ran `pipeline/01_download.py --check-availability --region US-CA --year 2023` in Colab with his key. Output pasted into `docs/HANDOFF.md`.

**FIRMS `/api/data_availability/` (exact answer):**

| data_id | min_date | max_date |
|---|---|---|
| MODIS_SP | 2000-11-01 | 2026-08-31 |
| VIIRS_SNPP_SP | 2012-01-20 | 2026-07-31 |
| VIIRS_NOAA20_SP | 2018-04-01 | 2026-07-31 |
| VIIRS_NOAA21_SP | **2023-03-01** | 2026-07-31 |
| MODIS_NRT | 2026-09-01 | 2026-11-14 |
| VIIRS_SNPP_NRT | 2026-08-01 | 2026-11-02 |
| VIIRS_NOAA20_NRT | 2026-08-01 | 2026-11-14 |
| VIIRS_NOAA21_NRT | 2024-01-17 | 2026-11-14 |
| LANDSAT_NRT | 2022-06-20 | 2026-11-14 |
| GOES_NRT | 2022-08-09 | 2026-11-14 |
| BA_MODIS | 2000-11-01 | 2026-08-01 |
| BA_VIIRS | 2012-03-01 | 2026-08-01 |

What this means:
- **Standard-processing data lags.** On 2026-11-14 the newest SP data was 2026-08-31 (MODIS) and 2026-07-31 (VIIRS). Months after that exist only as NRT. The calendar's last months must either use NRT (labelled provisional) or be shown as not yet available.
- **NOAA-21 SP starts 2023-03-01**, earlier than the FAQ's 17 Jan 2024. The pipeline downloads what FIRMS offers; whether to use NOAA-21 before 2024-01-17 for harmonization is a decision for S15 (open).
- `pipeline/01_download.py` now reads these dates from `data/raw/data_availability.csv` when it exists.
- FIRMS also lists `BA_MODIS` and `BA_VIIRS` (likely burned area, not read up on) and `GOES_NRT`. Not used yet; see `docs/sources.md`.

**CSV headers (exact, from the files):**
- `MODIS_SP`: `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type`
- `VIIRS_SNPP_SP` and `VIIRS_NOAA20_SP`: `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type`
- So: there is an `instrument` column, and **`type` is present in both MODIS and VIIRS SP data**. `VIIRS_NOAA21_SP` has the same header as the other VIIRS sources (seen in the S10 runs).

**Row counts, California box (approximate box, before any filtering), 2023:** MODIS_SP 8,438; VIIRS_SNPP_SP 38,691; VIIRS_NOAA20_SP 39,541. VIIRS returned about 4.6 times as many rows per satellite as MODIS (Terra + Aqua combined) for this box and year. One region-year; not a general ratio.

**Values in MODIS_SP (California box, 2000-11-01 to 2026-08-31, 368,690 rows; S10 run 2026-11-14):**
- `satellite`: **`Terra`** and **`Aqua`** (full words), **not** `T`/`A` as the attribute page says. The cleaning step must map `Terra`→`T`, `Aqua`→`A` (the data contract uses `T`/`A`).
- `confidence`: numbers 0–100 (most common `100`), as documented. Classes come from the MODIS user guide thresholds (§4).
- `version`: **`6.03`** (333,220 rows) and **`61.03`** (35,470 rows). So MODIS_SP mixes Collection 6 and Collection 6.1 files. The FAQ says C6.1 has no fire-algorithm changes (§6), but the date where it switches is not known yet: check in S11 and record it.
- `type`: `0` x360,157, `2` x8,318, `3` x207, `1` x8.
- `daynight`: `D` x225,234, `N` x143,456. `instrument`: always `MODIS`.

**Values in VIIRS SP (California box, full ranges; S10 run 2026-11-14):**

| Source | Rows | `satellite` | `confidence` | `version` | `type` 0 / 1 / 2 / 3 |
|---|---|---|---|---|---|
| VIIRS_SNPP_SP (2012-01-20 → 2026-07-31) | 1,117,337 | `N` | `n` 977,565 · `h` 86,032 · `l` 53,740 | `2` | 1,016,112 / 0 / 100,096 / 1,129 |
| VIIRS_NOAA20_SP (2018-04-01 → 2026-07-31) | 773,314 | `N20` | `n` 683,422 · `h` 52,669 · `l` 37,223 | `2` | 708,503 / 0 / 63,796 / 1,015 |
| VIIRS_NOAA21_SP (2023-03-01 → 2026-07-31) | 149,284 | `N21` | `n` 128,173 · `h` 12,137 · `l` 8,974 | `2` | 123,625 / 0 / 25,426 / 233 |

- VIIRS `confidence` is **lower-case letters `l`/`n`/`h`** (confirmed). VIIRS `satellite` codes match the docs (`N`, `N20`, `N21`). `version` `2` = Collection 2.
- **`type` 2 ("other static land source") is 9–17% of VIIRS rows** in this box (MODIS: 2.3%). Dropping non-vegetation types (the plan) matters much more for VIIRS than for MODIS; check this per region in S12.
- Low-confidence (`l`) is about 5–6% of VIIRS rows here, so SP data **does** contain low-confidence pixels.
- MODIS for the same box and full period: 368,690 rows (two satellites together), while each VIIRS satellite returned 2–3 times that over a shorter period.

**Row counts per region (download box, before cleaning or clipping to the real boundary):**

| Region | MODIS_SP | VIIRS_SNPP_SP | VIIRS_NOAA20_SP | VIIRS_NOAA21_SP | Total |
|---|---|---|---|---|---|
| US-CA | 368,690 | 1,117,337 | 773,314 | 149,284 | 2,408,625 |
| BR-PA | 2,707,098 | 5,348,275 | 2,857,121 | 1,206,395 | 12,118,889 |
| AU-NSW-VIC | 629,515 | 1,817,213 | 1,223,995 | 310,146 | 3,980,869 |
| PT | 102,903 | 158,096 | 78,298 | 40,676 | 379,973 |

Observations from BR-PA (2026-11-14 run):
- **Aqua has 1.84 times as many MODIS rows as Terra** (1,754,646 vs 952,452). In California they were nearly equal (179,076 vs 189,614). Aqua passes in the early afternoon and Terra mid-morning (FAQ, section 1). A plausible reason, not checked: tropical burning peaks in the afternoon. Consequence for harmonization: the Terra-only period (Nov 2000 – Jun 2002) will undercount compared with later years, and that effect is region-dependent. S15 must handle Terra and Aqua separately or per region.
- **`type` 2 (static land source) is only 0.3–0.5% of rows in BR-PA**, compared with 9–17% of VIIRS rows in California. The share of non-vegetation detections differs a lot by region.
- VIIRS low confidence (`l`) is 6.7–7.0% of rows in BR-PA.
- The BR-PA download box is a rectangle that also covers parts of neighbouring states, so these counts are larger than Pará itself until clipping (S11/S14).

Observations from AU-NSW-VIC (2026-11-15 run):
- **Aqua has 1.86 times as many MODIS rows as Terra** (409,204 vs 220,311), close to BR-PA (1.84) and unlike California (~0.94). So the Terra/Aqua imbalance is not only tropical; S15 still needs Terra and Aqua handled separately or per region.
- `type` 2 (static land source) is 2.3% of MODIS rows and 2.2–3.3% of VIIRS rows; `type` 3 (offshore) is under 0.2%.
- VIIRS low confidence (`l`) is 4.7% (S-NPP, NOAA-20) and 5.9% (NOAA-21) of rows.
- MODIS `version` again mixes `6.03` (559,083) and `61.03` (70,432).
- The box [140.8, -39.3, 153.8, -28.0] also covers a strip of southern Queensland (north of about -29) and of South Australia (west of 141°E), plus sea, until clipping.

Observations from PT (2026-11-15 run):
- **Aqua and Terra are nearly equal** (51,801 vs 51,102; ratio 1.01), like California (~0.94), unlike BR-PA (1.84) and AU-NSW-VIC (1.86).
- `type` 2 (static land source) is 1.2% of MODIS rows and 4.8–7.8% of VIIRS rows; `type` 3 (offshore) is 0.4–0.7% of VIIRS rows (the box includes Atlantic coast).
- VIIRS low confidence (`l`) is 4.8–6.4% of rows.
- MODIS `version`: `6.03` 87,246, `61.03` 15,657.
- The box [-9.7, 36.8, -6.0, 42.3] also covers a strip of western Spain (east of the border, about -6.2 to -7.5°) and sea, until clipping.
- **This run had 4 FIRMS limit waits** (11 min each; 3 in MODIS_SP near chunks 500/1000/1500, 1 in VIIRS_SNPP_SP near chunk 100) and several of the downloader's own pacing waits of 248–422 s. Earlier regions had no FIRMS limit waits. One Colab session was in use by then; the cause is still **not verified**. Possibly an earlier PT attempt (whose files went to Colab's temporary disk because Drive was not connected) had used the key's limit shortly before. It finished complete anyway.
- The Colab run used a `repo.zip` uploaded before PR #18 (it still prints short "rate limit: waiting N s" pauses). PR #18 changed only that message, so the download itself is the same code.

**FIRMS answers "Invalid MAP_KEY." when the limit is used up**, not only for a wrong key. A run that had already made about 2,000 successful requests was stopped by it. The downloader now waits and retries in that case.

**PT run (2026-11-15): 11-minute limit waits about every 500 chunks**, while the earlier regions had none. The PT box costs the same per request as the others: all four boxes fit in one 60°×60° tile. Cause **not verified**. Most likely a second Colab session (laptop and phone) using the same key, since the limit is per key. If waits continue with one session, lower `TRANSACTION_BUDGET` in `pipeline/config.py`.

**From the cleaned data (S11–S13, 2026-11-15; details `docs/validation/S13/README.md`):**
- **MODIS_SP `version` is `6.03` up to 2022-12-31 and `61.03` from 2023-01-01** in all four regions.
- **The only duplicate rows are the US-CA S09 overlap.** Exactly 8,438 / 38,691 / 39,541 rows were dropped (MODIS / S-NPP / NOAA-20), equal to the S09 test-year counts.
- **S-NPP alone / MODIS (Terra + Aqua) kept-detection ratio is fairly steady by region** (2013–2025): BR-PA 3.1–4.4, PT 2.5–3.9, US-CA 3.0–4.7, AU-NSW-VIC 3.7–5.6. The VIIRS-total / MODIS ratio jumps when NOAA-20 (2018) and NOAA-21 (2023) are added.
- **PT MODIS_SP has no rows at all for Dec 2025 – Jan 2026.** The 13 raw files are header-only (127 bytes). Expected from VIIRS daytime counts: about 6–20. No NASA outage notice was found. **Probably a FIRMS archive gap, not proven**; treat it as missing (`null`). Details: `docs/validation/S13/README.md`, follow-up section.
- **AU-NSW-VIC April peak:** small (median FRP 22 MW), daytime-only fires inside NSW/VIC, 97% outside the Queensland/SA strips. This fits autumn planned or agricultural burning (not checked against a source).
- **The Aqua/Terra ratio depends on season:** AU-NSW-VIC 1.1–1.3 in summer, 3–4.5 in autumn. The yearly ratio correlates 0.80 with the autumn share. Terra/Aqua corrections must depend on region and season.
- **NASA says Terra and Aqua are drifting from their designed orbits** (overpass times change) and will shut down from late 2026 / early 2027 ([NASA Earthdata](https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs)).

## 9. Still unverified

1. (Resolved: MODIS and VIIRS value formats and the NOAA-21 header are confirmed above.)
3. The direct MAP_KEY request URL.
4. Current mission status of Terra and Aqua beyond "to the present", including any orbit drift.
5. The LANCE Disclaimer text.
6. What `BA_MODIS` / `BA_VIIRS` are exactly.
