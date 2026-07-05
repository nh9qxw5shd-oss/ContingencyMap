#!/usr/bin/env python3
"""Convert the Network Rail Track Model shapefiles into the app's map assets.

Usage:
    pip install pyshp pyproj
    python3 tools/convert_nwr.py /path/to/folder-with-shapefiles

Expects these layers in the input folder (each as .shp/.dbf/.shx/.prj):
    NWR_ELRs, NWR_Waymarks, NWR_TrackCentreLines

Writes into assets/data/:
    nwr_elrs.json      - ELR route lines (simplified, WGS84) for the overlay & search
    nwr_waymarks.json  - mileposts as [elr, value, lat, lng, unit?] rows, sorted
    cl/{x}_{y}.json    - track centre-line tiles (0.5 deg grid) for the trace tool
"""

import json
import math
import os
import sys

import shapefile
from pyproj import Transformer

TILE_SIZE = 0.5           # degrees; must match TILE_SIZE in assets/admin.js
ELR_TOLERANCE_M = 6.0     # simplification for the route-line overlay
CL_TOLERANCE_M = 2.0      # simplification for track centre lines (keeps per-track fidelity)

tf = Transformer.from_crs(27700, 4326, always_xy=True)  # British National Grid -> WGS84


def simplify(pts, tol):
    """Douglas-Peucker on planar BNG metres (iterative)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        dmax, imax = 0.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if l2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > dmax:
                dmax, imax = d, k
        if dmax > tol:
            keep[imax] = True
            stack.append((i, imax))
            stack.append((imax, j))
    return [p for p, k in zip(pts, keep) if k]


def to_lonlat(seg):
    return [[round(lo, 5), round(la, 5)] for lo, la in (tf.transform(x, y) for x, y in seg)]


def convert_elrs(src, outdir):
    r = shapefile.Reader(os.path.join(src, "NWR_ELRs"))
    features = []
    for sr in r.iterShapeRecords():
        rec = sr.record
        pts = sr.shape.points
        parts = list(sr.shape.parts) + [len(pts)]
        lines = [to_lonlat(simplify(pts[a:b], ELR_TOLERANCE_M)) for a, b in zip(parts[:-1], parts[1:])]
        geom = (
            {"type": "LineString", "coordinates": lines[0]}
            if len(lines) == 1
            else {"type": "MultiLineString", "coordinates": lines}
        )
        features.append({
            "type": "Feature",
            "properties": {"elr": rec[1], "start": rec[2], "end": rec[3]},
            "geometry": geom,
        })
    path = os.path.join(outdir, "nwr_elrs.json")
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
    print(f"{path}: {len(features)} ELRs")


def convert_waymarks(src, outdir):
    r = shapefile.Reader(os.path.join(src, "NWR_Waymarks"))
    rows = []
    for sr in r.iterShapeRecords():
        rec = sr.record
        x, y = sr.shape.points[0]
        lo, la = tf.transform(x, y)
        row = [rec[1], round(rec[3], 4), round(la, 5), round(lo, 5)]
        if rec[2] != "M":
            row.append(rec[2])  # unit only stored when not miles
        rows.append(row)
    rows.sort(key=lambda r: (r[0], r[1]))  # the app relies on this ordering
    path = os.path.join(outdir, "nwr_waymarks.json")
    with open(path, "w") as f:
        json.dump(rows, f, separators=(",", ":"))
    print(f"{path}: {len(rows)} waymarks")


def convert_centrelines(src, outdir):
    r = shapefile.Reader(os.path.join(src, "NWR_TrackCentreLines"))
    tiles = {}
    n = 0
    for sr in r.iterShapeRecords():
        rec = sr.record
        pts = sr.shape.points
        parts = list(sr.shape.parts) + [len(pts)]
        aid = int(rec[0]) - 9001000000
        for pi, (a, b) in enumerate(zip(parts[:-1], parts[1:])):
            raw = pts[a:b]
            if len(raw) < 2:
                continue
            coords = to_lonlat(simplify(raw, CL_TOLERANCE_M))
            seg = [aid * 10 + pi, rec[1], rec[2], rec[3], rec[4], coords]
            n += 1
            lngs = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            for tx in range(math.floor(min(lngs) / TILE_SIZE), math.floor(max(lngs) / TILE_SIZE) + 1):
                for ty in range(math.floor(min(lats) / TILE_SIZE), math.floor(max(lats) / TILE_SIZE) + 1):
                    tiles.setdefault((tx, ty), []).append(seg)
    cl_dir = os.path.join(outdir, "cl")
    os.makedirs(cl_dir, exist_ok=True)
    for (tx, ty), items in tiles.items():
        with open(os.path.join(cl_dir, f"{tx}_{ty}.json"), "w") as f:
            json.dump({"segs": items}, f, separators=(",", ":"))
    print(f"{cl_dir}: {n} segments across {len(tiles)} tiles")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    outdir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "data")
    os.makedirs(outdir, exist_ok=True)
    convert_elrs(src, outdir)
    convert_waymarks(src, outdir)
    convert_centrelines(src, outdir)


if __name__ == "__main__":
    main()
