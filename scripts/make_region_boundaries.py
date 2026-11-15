"""Build data/boundaries/regions_ne.geojson: the real outlines of the pilot regions, from Natural Earth.

Source file (not committed, 40 MB): Natural Earth 10m admin-1 states/provinces, GeoJSON copy from
https://github.com/nvkelso/natural-earth-vector (geojson/ne_10m_admin_1_states_provinces.geojson).
Run once:  python3 scripts/make_region_boundaries.py <path to that file>

Each region is one MultiPolygon feature made of the Natural Earth parts listed in PARTS (not dissolved:
inner borders stay, which does not matter for point-in-region tests).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "boundaries" / "regions_ne.geojson"

# region id -> (Natural Earth "admin", list of iso_3166_2 codes or None = by rule below)
PARTS = {
    "US-CA": ("United States of America", ["US-CA"]),
    "BR-PA": ("Brazil", ["BR-PA"]),
    # ACT and Jervis Bay are enclaves inside New South Wales; included so the region has no holes.
    "AU-NSW-VIC": ("Australia", ["AU-NSW", "AU-VIC", "AU-ACT", "AU-X02~"]),
    # Mainland Portugal: the 18 districts PT-01..PT-18 (no Azores PT-20, no Madeira PT-30).
    "PT": ("Portugal", [f"PT-{i:02d}" for i in range(1, 19)]),
}


def main(src):
    data = json.load(open(src, encoding="utf-8"))
    features = []
    for region, (admin, codes) in PARTS.items():
        polys, used = [], []
        for f in data["features"]:
            p = f["properties"]
            if p.get("admin") == admin and p.get("iso_3166_2") in codes:
                g = f["geometry"]
                polys += g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
                used.append(p["iso_3166_2"])
        missing = sorted(set(codes) - set(used))
        if missing:
            raise SystemExit(f"{region}: not found in source: {missing}")
        polys = [[[[round(x, 5), round(y, 5)] for x, y in ring] for ring in poly] for poly in polys]
        xs = [x for poly in polys for x, _ in poly[0]]
        ys = [y for poly in polys for _, y in poly[0]]
        features.append({"type": "Feature",
                         "properties": {"region_id": region, "parts": sorted(used),
                                        "bbox": [min(xs), min(ys), max(xs), max(ys)]},
                         "geometry": {"type": "MultiPolygon", "coordinates": polys}})
        print(region, len(polys), "polygons", sum(len(r) for poly in polys for r in poly), "points",
              features[-1]["properties"]["bbox"])
    out = {"type": "FeatureCollection",
           "source": "Natural Earth 10m admin-1 states/provinces (naturalearthdata.com), via github.com/nvkelso/natural-earth-vector",
           "features": features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main(sys.argv[1])
