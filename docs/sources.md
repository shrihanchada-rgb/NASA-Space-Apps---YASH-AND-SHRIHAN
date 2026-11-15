# Sources used with FIRMS

FIRMS (NASA Fire Information for Resource Management System) is the main data source. This file lists **everything else** the project uses or plans to use alongside it, with its status. Verified facts about FIRMS itself are in `docs/data-notes.md`.

Status key: **Used** = already relied on. **Planned** = needed for a checklist step, not downloaded yet. **Optional** = nice to have, not required. **Licence checked** = terms read from a source named here; "not checked" means nobody has read the terms yet.

## 1. Documentation sources (read during S05)

| Source | What we used it for | URL |
|---|---|---|
| FIRMS FAQ | Satellite dates, S-NPP end, pixel sizes, overpass times, MODIS gaps, citation wording | https://www.earthdata.nasa.gov/data/tools/firms/faq |
| FIRMS attribute page | CSV columns, confidence, `type`, satellite codes, `version` | https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs |
| FIRMS API area page | Download URL format, SOURCE names, 5-day limit, 5000 calls / 10 min | https://firms.modaps.eosdis.nasa.gov/api/area/ |
| FIRMS API data availability | Endpoint to list date ranges per source (to run in S09) | https://firms.modaps.eosdis.nasa.gov/api/data_availability/ |
| MODIS C6/C6.1 Active Fire User's Guide v1.0 | MODIS confidence thresholds (Table 11), MCD14ML columns | https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf |
| VIIRS C2 375 m Active Fire User Guide v1.2 | VIIRS confidence classes, `type` codes, monthly product columns | https://www.earthdata.nasa.gov/s3fs-public/2025-06/VIIRS_C2_AF-375m_User_Guide_1.2.pdf |
| Schroeder et al. (2014), Remote Sensing of Environment 143: 85–96, doi:10.1016/j.rse.2013.12.008 | VIIRS 375 m algorithm reference (cited in the FIRMS FAQ; paper itself not read) | https://doi.org/10.1016/j.rse.2013.12.008 |

## 2. Other datasets used with FIRMS

| Dataset | Why we need it | Status | Licence | Where |
|---|---|---|---|---|
| **Region boundaries: Natural Earth admin-0 (countries) and admin-1 (states/provinces)** | Polygons for `regions.geojson` (California, Pará, NSW + Victoria, Portugal), bounding boxes for the FIRMS area API, and clipping hotspots to the region | **Used** (S14: `data/boundaries/regions_ne.geojson`, 10m admin-1 from the GitHub copy `nvkelso/natural-earth-vector`) | Described as public domain. A Natural Earth maintainer wrote that admin-1 licensing "needs a smidgen more work" outside the US. Not checked on the official terms page. | https://www.naturalearthdata.com |
| Region boundaries, alternative: geoBoundaries | Same as above, if Natural Earth admin-1 is not good enough | Optional | Described by a third party (atlas.co) as CC BY. Not checked. | https://www.geoboundaries.org |
| Region boundaries: **do not use GADM** | GADM is common, but its licence page says redistribution or commercial use is not allowed without permission. Our app redistributes the polygons, so avoid it. | Rejected | Checked (search summary of https://gadm.org/license.html) | https://gadm.org/license.html |
| FIRMS near real-time (`*_NRT` sources) | "Current fire" comparison only (README 3.1.7), labelled provisional | Planned (S27) | Same as FIRMS | FIRMS API |
| MODIS Burned Area MCD64A1 v6.1 (monthly, 500 m) | Independent check of fire seasons and big fire years (Section 13, Step E): do months with many hotspots also have a lot of burned area? | Optional | The Google Earth Engine catalog says no restrictions on use; DOI 10.5067/MODIS/MCD64A1.061. Not checked on the LP DAAC page. | https://doi.org/10.5067/MODIS/MCD64A1.061 |
| **NASA GIBS imagery** (Blue Marble Next Generation; MODIS Terra Corrected Reflectance true colour; Reference_Labels_15m; Coastlines_15m) | Satellite background for the website map | **Used** (website, 2026-11-14) | Free, no key; tiles allow cross-origin use (`access-control-allow-origin: *`, checked). NASA's data-use policy not re-read for GIBS specifically. Credit shown on the map and in the footer. | https://gibs.earthdata.nasa.gov |
| IBM Plex Sans / IBM Plex Mono fonts | Website typography | **Used** | OFL-1.1 (from the npm package licence field) | https://github.com/IBM/plex |
| ui-ux-pro-max skill | Design guidance | **Used** (development only, not shipped in the site) | MIT | `.claude/skills/ui-ux-pro-max/SOURCE.md` |
| News or official fire reports | Confirming that the worst years in the calendar match real events (Section 13, Step E) | Planned (S26) | Cite each one used | — |

## 3. Rules

- Before using a dataset in code, move it to **Used**, record the exact version or download date, and check its licence. Write the licence result here.
- Credit every dataset on the website's methods page.
- If a source is added, add a row here in the same pull request.
