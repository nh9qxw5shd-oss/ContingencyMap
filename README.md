# Contingency Map

A full-screen interactive railway map for incident response. Click the section of railway
where an incident is and the contingency plans for that section appear — including a
scenario chooser (full block vs reduced capacity etc.) when a section has several plans.

Everything is administered **inside the app** — sections are drawn directly on the map and
plans are edited with forms. There is no backend data entry and no code to change when the
railway coverage grows.

## Using the map

- The map fills the screen with the **official Network Rail track network** overlaid
  (from the NR Track Model open data pack — toggle with **NR network**). Detailed
  OpenRailwayMap tiles are available as a secondary **Rail tiles** toggle.
- **Search** (top bar): station names or CRS codes (`SAC`), junction names, ELR codes
  (`SPC1`), or `ELR mileage` (e.g. `SPC1 30`) to jump to an exact mileage — interpolated
  between the two nearest Network Rail waymarks. Location results show their nearest ELR
  so it's easy to pick the right one.
- Click (or tap) a highlighted section to open its plans. If the section has more than one
  plan you get a scenario chooser grouped by *Full block* / *Partial block* / *Degraded
  conditions*, with plan codes as the options.
- Each plan shows its summary, assumptions/constraints, linked documents and a
  **service-group table**: one row per service group with origin/destination, the action
  (Suspend / Alteration / Normal working) and the plan for that group.

## Admin

Click **Admin** (top right) and enter the admin passcode. From the admin panel you can:

### Sections
- **Create / edit / delete** sections (name, unique code, colour, notes, sort order).
- **Draw the section on the map** three ways:
  - **🛤 Trace railway** — the headline feature. It uses the **official Network Rail
    track centre lines** (shown as blue guide lines, loaded on demand for the area
    you're looking at), and every click snaps to the railway and routes along it. Click
    where the section starts, then click along to where it ends — you get the exact
    railway alignment in a few clicks. Works across junctions; use **Undo** to remove
    the last leg. Pan and it loads more track automatically.
  - **✏️ Draw line** — manual point-by-point line.
  - **⬠ Draw area** — click the corners of an area, for stations/depots (click zones).
- Geometry changes are previewed dashed on the map and only persisted when you press
  **Save section**.

### Plans
- Add any number of plans to a section. Each has: plan code, scenario (Full block /
  Partial block / Degraded conditions), title, summary, assumptions, constraints,
  document links and the **service-group table**.
- The service-group table is built row by row: service group, origin/destination, an
  action dropdown (Suspend / Alteration / Normal working) and the plan for that group.
- **📋 Bulk paste** — paste many rows at once, one per line:
  `Service group | Origin/Destination | S/A/N | Plan`.

### Passcode
- Change it any time from Admin → **Change passcode**. It is stored server-side and never
  in this repository.

## How it's built

Static site (no build step) + Supabase.

| File | Purpose |
| --- | --- |
| `index.html` | page shell |
| `assets/style.css` | styling |
| `assets/data.js` | Supabase client, data access, shared UI helpers |
| `assets/viewer.js` | map, NR network overlay, section rendering, plan viewer |
| `assets/search.js` | ELR / mileage search |
| `assets/admin.js` | admin panel, drawing/tracing tools, plan editor |
| `assets/data/nwr_elrs.json` | NR ELR route lines (overlay + search) |
| `assets/data/nwr_waymarks.json` | NR waymarks/mileposts (mileage search) |
| `assets/data/cl/*.json` | NR track centre-line tiles (trace tool, loaded on demand) |
| `tools/convert_nwr.py` | regenerates all of `assets/data/` from the NR shapefiles |

### Network Rail data

The `assets/data/` files are derived from the Network Rail **Track Model** open data pack
(`NWR_ELRs`, `NWR_Waymarks`, `NWR_TrackCentreLines`), reprojected from British National
Grid to WGS84 and simplified for the web. When Network Rail publish an updated extract,
regenerate with:

```
pip install pyshp pyproj
python3 tools/convert_nwr.py /path/to/extracted/shapefiles
```

### Data model (Supabase)

- `cmap_sections` — id, code, name, description, color, sort_order, `geometry`
  (GeoJSON LineString or Polygon).
- `cmap_plans` — belongs to a section; plan_code, title, severity, scenario_group,
  scenario_label, owner_team, summary, assumptions, constraints, `steps` (jsonb array),
  `docs` (jsonb array), sort_order.
- `cmap_config` — holds the admin passcode; locked down (RLS with no policies).

### Security

- Both content tables have **RLS enabled** with public **read-only** policies — the anon
  key in this repo can only read.
- All writes go through `SECURITY DEFINER` RPCs (`cmap_save_section`, `cmap_delete_section`,
  `cmap_save_plan`, `cmap_delete_plan`, `cmap_change_admin_code`) which check the admin
  passcode on every call.

### Run locally

Any static file server, e.g.:

```
python3 -m http.server 8000
```

then open http://localhost:8000.

### Legacy tables

The previous version's tables (`corridors`, `contingency_plans`, `corridor_plan_map`,
`plan_steps`, `plan_triggers`, `plan_docs`) are no longer used but were left in place.
Once you're happy with the new system you can drop them:

```sql
drop table if exists plan_docs, plan_triggers, plan_steps, corridor_plan_map,
  contingency_plans, corridors cascade;
```
