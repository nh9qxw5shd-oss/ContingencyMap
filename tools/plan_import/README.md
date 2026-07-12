# Excel plan import (July 2026)

One-off transfer of the ITSR MML contingency plans from the two source Excel
workbooks into the Contingency Map database (`cmap_plans` in Supabase):

- `ITSR  MML Contingency Plans London_ BedfordV4.xlsx` — MML-1 … MML-9 (plus
  a/b variants). The `(TC1) MML -0` sheet was skipped because MML-0 was
  already entered by hand and used as the reference example.
- `March 2026 V2  ITSR MML North Contingency Plans (Bedford_ Chesterfield).xlsx`
  — MML-N1 … MML-N25 (plus a variants).

All 56 plans were inserted into a holding section called **Plan Library**
(code `PLAN_LIBRARY`, no geometry). Each plan can be moved to its geographic
section once that section has been drawn on the map, by updating the plan's
`section_id`.

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

## Files

- `convert_excel_plans.py` — parses both workbooks and writes `plans.json`
  (needs `openpyxl`; the workbook paths at the top point at the original
  uploads and would need adjusting to re-run).
- `plans.json` — the converted plans exactly as inserted into `cmap_plans`.
