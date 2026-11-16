# S26: does the final calendar make sense? (README Section 13, Step E)

California only (the project's scope since 2026-11-15). Data: `data/processed/` built 2026-11-16, method `A1-1.0`, policy `blend`. Checked 2026-11-16 in the running app (Chromium, `cd web && npm run dev`) and with Python on the same files.

## 1. Fire season matches Step A.2

Step A.2 (S13) found California's season to be July to October, with the peak in August. The harmonized calendar shows the same thing. Share of all harmonized hotspots in 2003–2025, by calendar month:

| Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.7% | 2.3% | 2.5% | 2.1% | 1.8% | 4.7% | 13.8% | **30.1%** | 23.7% | 10.4% | 4.7% | 2.3% |

July to October hold 78.0%. **Result: matches.**

## 2. No unexplained jump around 2012

Yearly totals (harmonized; raw MODIS; raw VIIRS, all satellites):

| Year | Harmonized | Raw MODIS | Raw VIIRS |
|---|---|---|---|
| 2010 | 2,660 | 2,660 | – |
| 2011 | 3,310 | 3,310 | – |
| 2012 | 8,491 | 8,631 | 34,788 |
| 2013 | 9,350 | 9,619 | 38,165 |
| 2014 | 7,929 | 7,710 | 34,304 |
| 2015 | 11,204 | 10,711 | 49,517 |

- Harmonized ÷ raw MODIS is 0.98, 0.97, 1.03, 1.05 in 2012–2015, so the series follows MODIS through the start of VIIRS. Adding raw VIIRS would have multiplied 2012 by about 5.
- The rise from 2011 to 2012 is also in raw MODIS alone (3,310 → 8,631), so it is a change in fire activity seen by the same sensor, not a sensor effect. 2010 and 2011 are the two quietest full years in the record.
- The audit (`pipeline/06b_audit_processed.py`) checks the same thing every build: harmonized ÷ MODIS estimate is 0.95–1.05 in every year 2012–2025.

**Result: no unexplained jump.**

## 3. The worst years against published sources

Most active years (harmonized hotspots, full years): 2020 (48,425), 2021 (42,771), 2008 (20,585), 2018 (19,450), 2017 (16,670).

| Year | Confirmed? | What the source says | Source |
|---|---|---|---|
| 2020 | Yes | Largest season in California's modern record: nearly 10,000 fires, over 4.2 million acres; the August Complex became the largest wildfire in state history. Busiest month in the data: September 2020 (26,632). | CAL FIRE 2020 incident archive, https://www.fire.ca.gov/incidents/2020/ ; Cal OES, https://www.wildfirerecovery.caloes.ca.gov/past-incidents/august-september-2020-fires/ |
| 2021 | Yes | Dixie Fire, 963,309 acres, the largest single (non-complex) fire in California history; it burned from July to October 2021 and passed 430,000 acres in early August. Busiest month in the data: August 2021 (22,663). | https://en.wikipedia.org/wiki/Dixie_Fire ; CBS News, https://www.cbsnews.com/news/dixie-fire-californias-second-biggest-ever |
| 2008 | Yes | June 2008 lightning siege: over 2,000 fires, more than 1.1 million acres by late July. Busiest month of 2008 in the data: July (8,872). | Bay Nature (2008), https://baynature.org/magazine/fall2008/wildfire-in-california/ ; CAL FIRE news blog 24 Jul 2008, https://calfire.blogspot.com/2008/07/statewide-fire-overview-lightning.html |
| 2018 | Yes | Mendocino Complex (27 Jul – 18 Sep 2018), about 459,000 acres, then the largest wildfire in state history. In the app, a drawn area over it (-123.5, 38.75, -122.25, 39.75) ranks 2018 first of 25 years for Jul–Sep. | https://en.wikipedia.org/wiki/Mendocino_Complex_Fire ; ScienceDaily, https://sciencedaily.com/releases/2018/08/180807133233.htm |
| 2017 | Not checked | – | – |

These sources describe burned area, not hotspot counts, so they confirm that the years were exceptional; they do not check the size of the counts. Full-year statewide burned area for 2018 was not found in the sources read.

## 4. One-month download matches the app

In the app, dates 2020-09-01 to 2020-09-30, whole California, "Hotspots CSV":

- CSV rows: **277,285**. Map: "277,285 detections". `monthly.json` raw MODIS + raw VIIRS for Sep 2020: 277,285.
- Sum of `harmonized_weight` in the CSV: **26,632.25**. App summary "Hotspots (harmonized)": 26,632. `monthly.json` `count_harm`: 26,632.25.

Also checked with Python on the files: Aug 2021 (228,410 rows; weights 22,662.55 = `count_harm`), Jul 2008 (8,872; 8,872.0), Feb 2015 (1,138; 282.03), Aug 2001, a Terra-only month (1,087 rows; weights 2,235.04 = 1,087 × 2.056).

**Result: matches.**

## Summary

All four checks pass for California. 2017 was not checked against a source. The scores of the conversion itself are in `docs/validation/README.md`.
