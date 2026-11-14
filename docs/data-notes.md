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
- So: there is an `instrument` column, and **`type` is present in both MODIS and VIIRS SP data**. `VIIRS_NOAA21_SP` header not seen yet (no 2023 run of it).

**Row counts, California box (approximate box, before any filtering), 2023:** MODIS_SP 8,438; VIIRS_SNPP_SP 38,691; VIIRS_NOAA20_SP 39,541. VIIRS returned about 4.6 times as many rows per satellite as MODIS (Terra + Aqua combined) for this box and year. One region-year; not a general ratio.

**Values in MODIS_SP (California box, 2000-11-01 to 2026-08-31, 368,690 rows; S10 run 2026-11-14):**
- `satellite`: **`Terra`** and **`Aqua`** (full words), **not** `T`/`A` as the attribute page says. The cleaning step must map `Terra`→`T`, `Aqua`→`A` (the data contract uses `T`/`A`).
- `confidence`: numbers 0–100 (most common `100`), as documented. Classes come from the MODIS user guide thresholds (§4).
- `version`: **`6.03`** (333,220 rows) and **`61.03`** (35,470 rows). So MODIS_SP mixes Collection 6 and Collection 6.1 files. The FAQ says C6.1 has no fire-algorithm changes (§6), but the date where it switches is not known yet: check in S11 and record it.
- `type`: `0` x360,157, `2` x8,318, `3` x207, `1` x8.
- `daynight`: `D` x225,234, `N` x143,456. `instrument`: always `MODIS`.

**FIRMS answers "Invalid MAP_KEY." when the limit is used up**, not only for a wrong key. A run that had already made about 2,000 successful requests was stopped by it. The downloader now waits and retries in that case.

## 9. Still unverified

1. VIIRS values inside `confidence` (letters `l`/`n`/`h`?), `satellite`, `version`, `type`. MODIS values are now confirmed (above). The downloader prints a value summary per source.
2. `VIIRS_NOAA21_SP` header (expected same as other VIIRS).
3. The direct MAP_KEY request URL.
4. Current mission status of Terra and Aqua beyond "to the present", including any orbit drift.
5. The LANCE Disclaimer text.
6. What `BA_MODIS` / `BA_VIIRS` are exactly.
