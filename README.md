# Contingency Map

A full-screen interactive railway map for incident response. Click the section of railway
where an incident is and the contingency plans for that section appear — including a
scenario chooser (full block vs reduced capacity etc.) when a section has several plans.

Everything is administered **inside the app** — sections are drawn directly on the map and
plans are edited with forms. There is no backend data entry and no code to change when the
railway coverage grows.

## Using the map

- The map fills the screen with the real railway layout overlaid (OpenRailwayMap tiles —
  toggle with **Rail overlay**).
- Click a highlighted section to open its plans. If the section has more than one plan you
  get a scenario chooser, grouped by scenario (e.g. *Full block* / *Reduced capacity*).
- Each plan shows severity, owner team, summary, assumptions/constraints, linked documents
  and numbered steps.

## Admin

Click **Admin** (top right) and enter the admin passcode. From the admin panel you can:

### Sections
- **Create / edit / delete** sections (name, unique code, colour, notes, sort order).
- **Draw the section on the map** three ways:
  - **🛤 Trace railway** — the headline feature. It loads the *real* track layout from
    OpenStreetMap for the area you're looking at (shown as blue guide lines), and every
    click snaps to the railway and routes along it. Click where the section starts, then
    click along to where it ends — you get the exact railway alignment in a few clicks.
    Works across junctions; use **Undo** to remove the last leg. Zoom in (city level or
    closer) before loading; pan and it loads more track as needed.
  - **✏️ Draw line** — manual point-by-point line, for when OpenStreetMap data is
    unavailable.
  - **⬠ Draw area** — click the corners of an area, for stations/depots (click zones).
- Geometry changes are previewed dashed on the map and only persisted when you press
  **Save section**.

### Plans
- Add any number of plans to a section. Each has: plan code, title, severity, owner team,
  summary, assumptions, constraints, document links and ordered steps.
- **Scenario group + scenario label** control the chooser when a section has multiple
  plans (e.g. group `Full block`, label `St Albans → Radlett`). This replaces what used to
  be hardcoded decision logic — it's all data now.
- **📋 Bulk paste steps** — paste a whole plan at once, one step per line, optionally
  `Type | Title | Detail | Owner`.

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
| `assets/viewer.js` | map, section rendering, plan viewer |
| `assets/admin.js` | admin panel, drawing/tracing tools, plan editor |

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
