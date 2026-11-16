# S18: validation re-run and data checks

Made by `python3 pipeline/07_validate.py` on 2026-11-16. Result: **all checks passed**.

| Check | Result | Detail |
|---|---|---|
| re-run pipeline/05_calibrate.py | pass | Wrote /home/user/nasa-space-apps---yash-and-shrihan/data/interim/calibration/region_month.csv, terra_only.csv, |
| re-run pipeline/05b_compare_methods.py | pass | Wrote /home/user/nasa-space-apps---yash-and-shrihan/data/interim/calibration/compare (metrics.csv, choice.json |
| the re-run gives the committed S16 results for California (all methods, choice, band, parameters) | pass | identical |
| S16 chose a method for US-CA | pass | method A1 |
| scores in metadata.json are the chosen method's test scores | pass | site: R2 0.992, error 11.8%; S16: R2 0.992, error 11.8% |
| k per calendar month in the data equals the one fitted in step 05 | pass | largest difference 0.00e+00 |
| uncertainty band in the data equals S16's band | pass | [0.812, 1.319] vs 0.812..1.319 |
| method_version agrees in metadata and region files | pass | A1-1.0 |
| data is real, not sample | pass |  |
| data contract: scripts/validate_data.py data/processed | pass | 0 problem(s) in data/processed |
| audit: no double counting, harmonization arithmetic right | pass | All checks passed |
| forecast: 7 days after the data ends, quantiles ordered, same method version | pass | 2026-09-01 to 2026-09-07 |
| the site's default data folder is data/processed | pass | ../data/processed |
| no other project's data file or address in web/ | pass |  |

The scores and plots themselves are in `docs/validation/S16/` (metrics table: `metrics.csv`; plots: `<REGION>_compare.png`); the summary is `docs/validation/README.md`.
