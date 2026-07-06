#!/usr/bin/env python3
"""Build assets/data/locations.json: named stations & junctions on the NR network.

Usage:
    # 1. fetch named rail locations from OpenStreetMap (Overpass API):
    curl -sS -X POST --data-urlencode 'data=
        [out:json][timeout:180];
        area["ISO3166-1"="GB"][admin_level=2]->.gb;
        ( node(area.gb)["railway"="station"]["name"];
          node(area.gb)["railway"="junction"]["name"]; );
        out body;' https://overpass.kumi.systems/api/interpreter -o locations_raw.json

    # 2. filter to the NR network and tag each location with its nearest ELR
    #    (requires assets/data/cl/ to exist — see convert_nwr.py):
    python3 tools/build_locations.py locations_raw.json

Output rows: [name, lat, lng, kind('s'|'j'), crs, elr]
"""

import glob
import json
import os
import sys
from collections import defaultdict

CELL = 0.005          # proximity grid for "is this on the NR network?" (~400 m)
ELR_CELL = 0.01       # search grid for nearest-ELR lookup (~1 km)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    raw = json.load(open(sys.argv[1]))["elements"]

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cl_dir = os.path.join(root, "assets", "data", "cl")

    near_grid = set()
    elr_cells = defaultdict(list)  # cell -> [(elr, coords)]
    for path in glob.glob(os.path.join(cl_dir, "*.json")):
        for seg in json.load(open(path))["segs"]:
            elr, coords = seg[1], seg[5]
            for lng, lat in coords:
                near_grid.add((int(lng // CELL), int(lat // CELL)))
            lngs = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            for x in range(int(min(lngs) // ELR_CELL), int(max(lngs) // ELR_CELL) + 1):
                for y in range(int(min(lats) // ELR_CELL), int(max(lats) // ELR_CELL) + 1):
                    elr_cells[(x, y)].append((elr, coords))

    def near_track(lat, lng):
        cx, cy = int(lng // CELL), int(lat // CELL)
        return any((cx + dx, cy + dy) in near_grid for dx in (-1, 0, 1) for dy in (-1, 0, 1))

    def pt_seg_d2(px, py, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
        ex, ey = ax + t * dx, ay + t * dy
        return (px - ex) ** 2 + ((py - ey) * 1.6) ** 2  # rough anisotropy at UK latitudes

    def nearest_elr(lat, lng):
        best, bd = "", 1e9
        cx, cy = int(lng // ELR_CELL), int(lat // ELR_CELL)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for elr, coords in elr_cells.get((cx + dx, cy + dy), ()):
                    for a, b in zip(coords[:-1], coords[1:]):
                        d2 = pt_seg_d2(lng, lat, a[0], a[1], b[0], b[1])
                        if d2 < bd:
                            bd, best = d2, elr
        return best

    rows, seen = [], set()
    for e in raw:
        t = e["tags"]
        name = t["name"].strip()
        kind = "j" if t.get("railway") == "junction" else "s"
        if t.get("station") in ("subway", "monorail", "funicular") or t.get("subway") == "yes":
            continue
        if not near_track(e["lat"], e["lon"]):
            continue
        key = (name.lower(), kind, round(e["lat"], 2), round(e["lon"], 2))
        if key in seen:
            continue
        seen.add(key)
        crs = t.get("ref:crs") or t.get("ref") or ""
        if not (kind == "s" and len(crs) == 3 and crs.isalpha()):
            crs = ""
        rows.append([name, round(e["lat"], 5), round(e["lon"], 5), kind, crs.upper(), nearest_elr(e["lat"], e["lon"])])

    rows.sort(key=lambda r: r[0].lower())
    out = os.path.join(root, "assets", "data", "locations.json")
    with open(out, "w") as f:
        json.dump(rows, f, separators=(",", ":"), ensure_ascii=False)
    st = sum(1 for r in rows if r[3] == "s")
    print(f"{out}: {len(rows)} locations ({st} stations, {len(rows) - st} junctions)")


if __name__ == "__main__":
    main()
