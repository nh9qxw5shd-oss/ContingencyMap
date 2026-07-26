#!/usr/bin/env python3
"""Build the geographic sections for the MML North plans (MML-N1 … MML-N25).

Same routing the admin panel's "Create route between locations" button uses:
a graph over the Network Rail track centre lines in ../../assets/data/cl/*.json,
Dijkstra between the snapped endpoints. Running it against Bedford -> Luton
reproduces the hand-made BEDFORD_LUTON section point for point.

Two extras on top of the in-app tool:

  * Adjacent sections are cut out of one long through-route rather than routed
    one by one, so neighbours share their join vertex exactly. Routing each
    section separately snaps the junction to whichever track carries it, which
    leaves a short spur where the two sections should meet.
  * decloop() drops out-and-back excursions left by endpoint snapping.

Writes north_sections.json (sections exactly as inserted into cmap_sections).
"""
import json, math, heapq, os

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "data")
TILE = 0.5          # degrees; must match the build pipeline
SNAP_MAX = 2500     # metres, as in admin.js
CLAY_CROSS_NORTH = (53.18122, -1.40130)   # SPC8 / SPC9 / TCC meet; not in locations.json


def haversine(a, b):
    R, rad = 6371000.0, math.pi / 180
    dlat, dlng = (b[0] - a[0]) * rad, (b[1] - a[1]) * rad
    q = (math.sin(dlat / 2) ** 2
         + math.cos(a[0] * rad) * math.cos(b[0] * rad) * math.sin(dlng / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(q))


class Rail:
    """The loaded track centre lines as an undirected graph."""

    def __init__(self):
        self.nodes, self.adj, self.elrs = {}, {}, {}
        self._segs, self._tiles = set(), set()

    @staticmethod
    def key(lng, lat):
        return f"{lng:.5f},{lat:.5f}"

    def load_box(self, lng0, lat0, lng1, lat1, pad=0.3):
        for tx in range(math.floor((min(lng0, lng1) - pad) / TILE),
                        math.floor((max(lng0, lng1) + pad) / TILE) + 1):
            for ty in range(math.floor((min(lat0, lat1) - pad) / TILE),
                            math.floor((max(lat0, lat1) + pad) / TILE) + 1):
                self._load_tile(f"{tx}_{ty}")

    def _load_tile(self, name):
        if name in self._tiles:
            return
        self._tiles.add(name)
        path = os.path.join(DATA, "cl", name + ".json")
        if not os.path.exists(path):       # sea / no rail here
            return
        for seg in json.load(open(path)).get("segs", []):
            aid, elr, coords = seg[0], seg[1], seg[5]
            if aid in self._segs or len(coords) < 2:
                continue
            self._segs.add(aid)
            prev = None
            for lng, lat in coords:
                k = self.key(lng, lat)
                self.nodes.setdefault(k, (lat, lng))
                self.elrs.setdefault(k, set()).add(elr)
                if prev is not None and prev != k:
                    w = haversine(self.nodes[prev], (lat, lng))
                    self.adj.setdefault(prev, []).append((k, w))
                    self.adj.setdefault(k, []).append((prev, w))
                prev = k

    def nearest(self, lat, lng, elr=None):
        best, best_d = None, float("inf")
        for k, pos in self.nodes.items():
            if elr and elr not in self.elrs.get(k, ()):
                continue
            d = haversine((lat, lng), pos)
            if d < best_d:
                best, best_d = k, d
        return best if best and best_d <= SNAP_MAX else None

    def shortest_path(self, a, b):
        dist, prev, heap = {a: 0.0}, {}, [(0.0, a)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == b:
                break
            if d > dist.get(u, float("inf")):
                continue
            for v, w in self.adj.get(u, ()):
                if d + w < dist.get(v, float("inf")):
                    dist[v] = d + w
                    prev[v] = u
                    heapq.heappush(heap, (d + w, v))
        if b not in prev:
            return None
        out, cur = [b], b
        while cur != a:
            cur = prev[cur]
            out.append(cur)
        return out[::-1]


def decloop(pts, tol=40.0):
    """Drop out-and-back detours: if a later vertex comes back within tol of an
    earlier one, everything between them is a snapping artifact, not railway."""
    out = list(pts)
    i = 0
    while i < len(out) - 2:
        for j in range(len(out) - 1, i + 1, -1):
            if haversine(out[i], out[j]) <= tol:
                del out[i + 1:j + 1]
                break
        i += 1
    return out


def locations():
    rows = json.load(open(os.path.join(DATA, "locations.json")))
    return [{"name": r[0], "lat": r[1], "lng": r[2]} for r in rows]


LOCS = locations()


def loc(name, near=None):
    """Coordinates of a named station/junction; `near` disambiguates repeats."""
    hits = [l for l in LOCS if l["name"] == name]
    if not hits:
        raise SystemExit("no such location: " + name)
    if near:
        hits.sort(key=lambda l: haversine((l["lat"], l["lng"]), near))
    return (hits[0]["lat"], hits[0]["lng"])


rail = Rail()
rail.load_box(-2.1, 52.0, -0.4, 53.4)


def route(a, b, elr_b=None):
    na, nb = rail.nearest(*a), rail.nearest(*b, elr=elr_b)
    path = rail.shortest_path(na, nb)
    assert path, f"no rail route between {a} and {b}"
    return [rail.nodes[k] for k in path]


def split(pts, *at):
    """Cut a through-route at the vertices nearest the given points."""
    idx = [0] + [min(range(len(pts)), key=lambda i: haversine(pts[i], t)) for t in at] + [len(pts) - 1]
    return [pts[idx[k]:idx[k + 1] + 1] for k in range(len(idx) - 1)]


def convex_hull(pts):
    pts = sorted(set(pts))
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def station_zone(centre, radius=320, grow=45):
    """Click zone round a station: hull of the track there, pushed out a little."""
    near = [(ln, la) for la, ln in rail.nodes.values() if haversine(centre, (la, ln)) <= radius]
    hull = convex_hull(near)
    cx = sum(p[0] for p in hull) / len(hull)
    cy = sum(p[1] for p in hull) / len(hull)
    ring = []
    for x, y in hull:
        dx, dy = x - cx, y - cy
        n = max(1e-9, math.hypot(dx, dy))
        ring.append([round(x + dx / n * grow / (111320 * math.cos(math.radians(y))), 5),
                     round(y + dy / n * grow / 110540, 5)])
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


BEDFORD = loc("Bedford")
KETTERING = loc("Kettering")
LEICESTER = loc("Leicester")
LOUGHBOROUGH = loc("Loughborough", (52.77958, -1.19651))
TRENT_SOUTH = loc("Trent South Junction")
TRENT_EAST = loc("Trent East Junction", (52.88452, -1.26523))
MANSFIELD = loc("Mansfield Junction")
NOTTINGHAM = loc("Nottingham")
RADFORD = loc("Radford Junction")
TROWELL = loc("Trowell South Junction")
SHEET_STORES = loc("Sheet Stores Junction")
DERBY = loc("Derby", (52.91652, -1.46261))
AMBERGATE = loc("Ambergate Junction")
TAPTON = loc("Tapton Junction")
LONDON_ROAD = loc("London Road Junction", (52.91362, -1.4624))
STENSON = loc("Stenson Junction")
WICHNOR = loc("Wichnor Junction")
TAMWORTH = loc("Tamworth")

sections = []


def add(name, pts, plans):
    pts = decloop(pts)
    sections.append({
        "code": name.upper().replace("–", " ").replace("-", " "),   # replaced below
        "name": name,
        "plans": plans,
        "geometry": {"type": "LineString",
                     "coordinates": [[round(p[1], 5), round(p[0], 5)] for p in pts]},
    })


# Midland Main Line, Bedford to Trent
a, b, c, d = split(route(BEDFORD, TRENT_SOUTH), KETTERING, LEICESTER, LOUGHBOROUGH)
add("Bedford – Kettering", a, ["MML-N1", "MML-N1a", "MML-N2", "MML-N2a", "MML-N3", "MML-N3a"])
add("Kettering – Leicester", b, ["MML-N4", "MML-N4a", "MML-N5", "MML-N5a"])
add("Leicester – Loughborough", c,
    ["MML-N6", "MML-N6a", "MML-N7", "MML-N7a", "MML-N8", "MML-N8a", "MML-N9", "MML-N9a"])
add("Loughborough – Trent South Jn", d, ["MML-N10", "MML-N10a"])

# Trent to Nottingham
a, b = split(route(TRENT_EAST, NOTTINGHAM), MANSFIELD)
add("Trent East Jn – Mansfield Jn", a, ["MML-N11", "MML-N11a"])
add("Mansfield Jn – Nottingham", b, ["MML-N12", "MML-N12a"])

# Nottingham to Trowell
a, b = split(route(MANSFIELD, TROWELL), RADFORD)
add("Mansfield Jn – Radford Jn", a, ["MML-N18"])
add("Radford Jn – Trowell Jn", b, ["MML-N19"])

add("Sheet Stores Jn – Derby", route(SHEET_STORES, DERBY), ["MML-N14", "MML-N14a"])

# Derby northwards
a, b, c = split(route(DERBY, TAPTON), AMBERGATE, CLAY_CROSS_NORTH)
add("Derby – Ambergate Jn", a, ["MML-N16", "MML-N16a"])
add("Ambergate Jn – Clay Cross North Jn", b, ["MML-N17"])
add("Clay Cross North Jn – Tapton Jn", c, ["MML-N21"])

# Erewash Valley line, as far as Clay Cross
a, _ = split(route(TROWELL, TAPTON), CLAY_CROSS_NORTH)
add("Trowell Jn – Clay Cross North Jn", a, ["MML-N20"])

# Birmingham – Derby line
a, b = split(route(LONDON_ROAD, WICHNOR), STENSON)
add("London Road Jn – Stenson Jn", a, ["MML-N22", "MML-N23"])
add("Wichnor Jn – Stenson Jn", b[::-1], ["MML-N24"])
add("Wichnor Jn – Tamworth", route(WICHNOR, TAMWORTH, elr_b="DBP1"), ["MML-N25"])

# Station-only blocks get a click zone rather than a line
sections.append({"code": "", "name": "Nottingham Station", "plans": ["MML-N13", "MML-N13a"],
                 "geometry": station_zone(NOTTINGHAM)})
sections.append({"code": "", "name": "Derby Station", "plans": ["MML-N15", "MML-N15a"],
                 "geometry": station_zone(DERBY)})

# Codes exactly as the admin panel derives them from the name
import re
for s in sections:
    s["code"] = re.sub(r"[^A-Z0-9]+", "_", s["name"].upper()).strip("_")[:24].rstrip("_")

with open(os.path.join(os.path.dirname(__file__), "north_sections.json"), "w") as f:
    json.dump(sections, f, indent=1, ensure_ascii=False)

for s in sections:
    g = s["geometry"]
    ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]
    km = sum(haversine((ring[i][1], ring[i][0]), (ring[i + 1][1], ring[i + 1][0]))
             for i in range(len(ring) - 1)) / 1000
    print(f"{s['code']:26s} {len(ring):4d} pts {km:6.2f} km  {len(s['plans'])} plans")
