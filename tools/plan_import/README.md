# Excel plan import (July 2026)

One-off transfer of the ITSR MML contingency plans from the two source Excel
workbooks into the Contingency Map database (`cmap_plans` in Supabase):

- `ITSR  MML Contingency Plans London_ BedfordV4.xlsx` — MML-1 … MML-9 (plus
  a/b variants). The `(TC1) MML -0` sheet was skipped because MML-0 was
  already entered by hand and used as the reference example.
- `March 2026 V2  ITSR MML North Contingency Plans (Bedford_ Chesterfield).xlsx`
  — MML-N1 … MML-N25 (plus a variants).

All 56 plans were inserted into a holding section called **Plan Library**
(code `PLAN_LIBRARY`, no geometry) and then moved onto geographic sections as
those sections were drawn. The Plan Library is now empty; it is kept as the
landing place for any future import.

The London plans (MML-0 … MML-9) were placed by hand in the admin panel. The
North plans (MML-N1 … MML-N25) were placed by `route_sections.py` — see
**MML North sections** below.

## Conventions (copied from the hand-entered MML-0 example)

- `plan_code` from the sheet tab, normalised (`MML -1` → `MML-1`).
- `scenario_group` from the banner: "Full Block Plan" → *Full block*,
  "Partial Block Plan" → *Partial block*.
- `summary` = the sheet's Infrastructure Restriction cell.
- One step per service group: CANCELLED → *Suspend*, RUN AS BOOKED →
  *Normal working*, everything else → *Alteration*.
- Thameslink headcodes get an `xx` suffix and the TLK tag is dropped
  (`9R TLK` → `9Rxx`); peak markers kept (`9Kxx (PEAK)`); EMR groups keep
  their codes with `(EMR)`.
- North workbook sheets with separate NORTH/SOUTH tables are merged into one
  step per service group with `NORTH OF BLOCK: … / SOUTH OF BLOCK: …` in the
  plan text (same convention MML-0 uses for split services).
- Footnote bullet lists (e.g. "Maximise Rolling Stock formations…") go into
  the plan's `constraints` field.
- `MML-2a` is colour-coded in the source (green = run as booked, yellow =
  amended); the colours were decoded from the cell fills.

## MML North sections

The 41 North plans went onto 18 sections, following the pattern already set by
the London plans: one section per stretch of railway, all the plans for that
stretch hanging off it as scenarios, and a station click zone rather than a
line where the plan is about the station itself (MML-N13 Nottingham, MML-N15
Derby).

Where several plans cover the same railway they share one section, so the map
has no overlapping sections to click through — Bedford–Kettering carries all
six of MML-N1/N1a/N2/N2a/N3/N3a (they differ only in which stations stay
available), and Leicester–Loughborough carries the eight N6–N9a plans,
including the Leicester–Syston ones, Syston being inside that stretch.

| Section | Plans |
| --- | --- |
| Bedford – Kettering | MML-N1, N1a, N2, N2a, N3, N3a |
| Kettering – Leicester | MML-N4, N4a, N5, N5a |
| Leicester – Loughborough | MML-N6, N6a, N7, N7a, N8, N8a, N9, N9a |
| Loughborough – Trent South Jn | MML-N10, N10a |
| Trent East Jn – Mansfield Jn | MML-N11, N11a |
| Mansfield Jn – Nottingham | MML-N12, N12a |
| Nottingham Station | MML-N13, N13a |
| Sheet Stores Jn – Derby | MML-N14, N14a |
| Derby Station | MML-N15, N15a |
| Derby – Ambergate Jn | MML-N16, N16a |
| Ambergate Jn – Clay Cross North Jn | MML-N17 |
| Mansfield Jn – Radford Jn | MML-N18 |
| Radford Jn – Trowell Jn | MML-N19 |
| Trowell Jn – Clay Cross North Jn | MML-N20 |
| Clay Cross North Jn – Tapton Jn | MML-N21 |
| London Road Jn – Stenson Jn | MML-N22, N23 |
| Wichnor Jn – Stenson Jn | MML-N24 |
| Wichnor Jn – Tamworth | MML-N25 |

Geometry comes from the same Network Rail track centre lines and the same
Dijkstra routing as the admin panel's **⚡ Create route between locations**
button — routing Bedford to Luton with the script reproduces the hand-made
`BEDFORD_LUTON` section point for point. Two things the script does that
clicking the button does not:

- Neighbouring sections are cut out of a single through-route (Bedford → Trent
  South Jn, Derby → Tapton Jn, and so on) so they share their join vertex
  exactly, instead of each snapping the junction to whichever track carries it.
- Out-and-back spurs left by endpoint snapping are removed.

Clay Cross North Jn is not in `locations.json`, so it is pinned in the script
at 53.18122, -1.40130 — the point where ELRs SPC8, SPC9 and TCC meet.

Sections were inserted straight into `cmap_sections` and the plans repointed by
`section_id`; nothing about the plans themselves changed.

## Files

- `convert_excel_plans.py` — parses both workbooks and writes `plans.json`
  (needs `openpyxl`; the workbook paths at the top point at the original
  uploads and would need adjusting to re-run).
- `plans.json` — the converted plans exactly as inserted into `cmap_plans`.
- `route_sections.py` — builds the 18 MML North sections from the NR track
  model in `assets/data/`. No dependencies; re-running it rewrites
  `north_sections.json` identically.
- `north_sections.json` — the sections exactly as inserted into
  `cmap_sections`, each with the plan codes assigned to it.
