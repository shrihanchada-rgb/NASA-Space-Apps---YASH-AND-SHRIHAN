# S31: the 3-minute demo

**Site:** https://shrihanchada-rgb.github.io/NASA-Space-Apps---YASH-AND-SHRIHAN/ (or `cd web && npm run dev` on the same data).
**Story in one sentence:** satellites count fires differently, so we put 25 years on one scale, and anyone can pick any part of California and any dates.
**Rehearsed:** 2026-11-16 by `scripts/rehearse_demo.js` (18 checks, all passed; the clicks below, on the real data; screenshots in `docs/demo/`). Machine time for all steps together is about 14 seconds, so the 3 minutes are yours to talk in.

Say it in plain words. Every number below was produced by the rehearsal; read it off the screen rather than from memory.

| Time | Page | Do | Say | You should see |
|---|---|---|---|---|
| 0:00 | **Latest** (home) | Open the site. Point at the title, the blue bar and the stats line. | "Two satellite families see fires: MODIS since 2000 and VIIRS since 2012. VIIRS sees far more small fires, so you cannot add them. Califire puts both on one scale, MODIS-equivalent hotspots, so 2005 and 2025 can be compared. This is California day by day. The blue bar says: select part of the state on the map and every page shows just that area." | "California, day by day." Biggest day on record **2,847.6** hotspots, **Sep 9, 2020**. |
| 0:35 | **Map** | Click Map. Dates are all data; type 2025-01-01 to 2025-01-31 in the date boxes (or use the link `map.html?start=2025-01-01&end=2025-01-31`). Click **Draw an area** and drag a rectangle around Los Angeles. (Typing coordinates in "Enter an area by coordinates" does the same: W -119, S 33.6, E -117.4, N 34.6.) | "This is January 2025, the month of the Palisades and Eaton fires, both started 7 January 2025. Every dot is a satellite detection, blue MODIS, orange VIIRS. I draw a rectangle around Los Angeles. The map only lets me draw inside California, and it snaps to a 25 km grid." | About **10,790** detections in the state for the month. The bar turns orange: "Showing a drawn area … on every page". |
| 1:05 | **Latest** | Click Latest (the area stays). Click **8** in the January 2025 grid. | "Now the whole site is just my rectangle. 8 January is the strongest day in this area." | Title "Your area, day by day". **Jan 8, 2025 = 193.5** hotspots (day **67.4**, night **126.1**). The panel says the ranking against other years is California-wide only. |
| 1:35 | **Map**, scroll to the comparison | Click Map, scroll below the map. | "Is that unusual? The comparison puts January 2025 against every other January." | **458** hotspots in the area in Jan 2025, **1st of 26** Januaries. The next biggest is Jan 2004 with 35 (92% less). |
| 2:00 | **Archive** | Click **Show all of California** in the bar. Click Archive. Click **Anomaly**, then back to **Count (log)**. Click the **Sep 2020** cell. | "Every year since 2000 in one picture. 2020 is the worst year: **48,425** hotspots, September 2020 alone **26,632**. That matches the record fire season: California's largest in modern times, over 4.2 million acres (CAL FIRE). Blank hatched cells are days with no satellite data, never zero." | 2020 has the biggest year total (**48,425**). Clicking Sep 2020 sets the dates to 2020-09-01 to 2020-09-30. |
| 2:25 | **Download** | Click Download, then **Daily series CSV**. | "Everything is downloadable. This file has one row per day for September 2020, with the method and citation at the top." | **30 rows**; the harmonized counts add up to **26,632**, the same as the calendar. |
| 2:40 | **Methodology** | Click Methodology, scroll to **Known limits**. | "We are honest about limits. The range is approximate, the conversion is less accurate after 2023, the first 20 months have Terra only, and a hotspot is not a burned area. The purple forecast days on Latest come from a time-series model; on our data it does no better than repeating the last day, and it cannot see the biggest days coming. It is a forecast of satellite detections, not of fire risk." | Test scores R² **0.992**, typical error **11.8%**; forecast table (**14.6** model, **14.4** repeat last day, **18.9** seasonal). |

**Closing line (2:55):** "Our counts, from NASA's open FIRMS data, with the uncertainty on the page. Try it: pick any part of California."

## If something goes wrong

- **Map is slow or offline:** use the screenshots in `docs/demo/` (`1-latest-home.png` … `7-methodology-limits.png`, one per step).
- **GitHub Pages is down:** run the site locally (`cd web && npm install && npm run dev`); it uses the same data.
- **Draw does not land where you want:** use "Enter an area by coordinates" (numbers in step 2).

## Likely questions, with true answers

- **Why not just add MODIS and VIIRS?** VIIRS sees about 3–5 times more detections than MODIS; adding them would show a fake jump in 2012 and again in 2018 and 2023. Our harmonization removes it (checked on 2012–2015: within 3–5% of MODIS).
- **How accurate is it?** On years it had not seen (2019–2023), R² 0.992 and a typical monthly error of 11.8%; worse for small months and after 2023. See Methodology.
- **Is the forecast reliable?** No, it is experimental. On ordinary days it is the best of three simple methods; on the busiest days every method fails.
- **What about days with no data?** They are hatched or marked NA, never zero. Satellite outages are handled as missing data.
- **Why does the data end in August 2026?** NASA's standard archive lags by a few months. Near-real-time data is not included yet.
- **Other states?** Only California is built; the method was tested on three more regions (see `docs/validation/`).

## Section 8 (definition of done), checked on 2026-11-16

| Claim | Status | Evidence |
|---|---|---|
| Pipeline reproduces from raw | **True from the filtered files; steps 01–04 not re-run now** | S30: `06_aggregate.py` rebuilt `data/processed/` into an empty folder, 319 of 321 files identical (the other two are the hand-written README and the forecast file). Download, clean, filter and grid (01–04) ran in Colab on earlier days (`docs/HANDOFF.md`) and need Colab to re-run. |
| Validation report published | True | `docs/validation/README.md`; `python3 pipeline/07_validate.py` → 14/14; Methodology page. |
| Web app deployed | **Deploy job succeeded; live page to be opened by a person** | GitHub Actions "Deploy website" success; the AI session cannot open github.io. |
| Calendar, analytics and CSV work for the pilot regions | True for California (the only region since the 2026-11-15 scope change) | `scripts/rehearse_demo.js`: 18/18 checks on the real data. |
| Methods page honest about uncertainty | True | Methodology "Known limits", validation scores and forecast scores (rehearsal step 7). |
