# Grouping and serial collection proposal

This is the initial design proposal written while scanning fixes took priority.
The subsequent implementation and exact scope are documented in
[GROUPS_AND_SETS.md](GROUPS_AND_SETS.md); its limitations take precedence over
future ideas below.

## Recommendation

Combine shared model details with individual asset records, and collect serials
by priority. A missing manufacturer serial does not prevent assigning a unique
JCP tag and recording the unit's location. Leave the serial blank; show a
separate “Not recorded” status rather than storing `N/A`, `UNKNOWN` or an invented
serial that could interfere with duplicate matching.

| Priority | Equipment | Registration approach |
| --- | --- | --- |
| First | Assigned, valuable, data-bearing, warranty-covered or frequently repaired equipment: laptops, PCs, SSDs, printers, network equipment | One JCP tag and record per physical unit. Capture the serial when readable; otherwise flag it for follow-up. Keep movement, maintenance and audit history per unit. |
| Next | Identical monitors, keyboards, mice and other reusable equipment | Shared model template to reduce typing, with individual tags where assignment, repair or loss must be traced. Collect missing serials later. |
| Lower | Cheap interchangeable cables and consumables | Consider quantity tracking per item type and storage location, with stock movements. This requires a separate stock design; do not represent ten items as one ordinary asset record. |

Choose priority by operational need, not category alone: an expensive keyboard
or specialist cable may warrant individual tracking. Do not impose a serial
requirement that prevents staff recording a real asset with a damaged label.

## Example and workflow

For ten identical 120 GB SSDs, show a model group such as “Apacer · AP120GAS340G ·
120 GB · 10 units”, expandable into ten JCP records. Each unit retains its own
serial, condition, placement, host-device relationship if supported later, and
history. A model group is a display/template relationship, never proof that
two physical units are duplicates.

1. Scan one clear label and approve category, brand, model and shared specs.
2. Save those approved common fields as a model template.
3. Choose “Add another of this model”. Copy common details into a new draft;
   clear serial, identifiers, photos, assignment, condition and all history.
   Offer an explicit location default rather than copying it silently.
4. Scan or enter this unit's serial, or choose “Record serial later”.
5. Check existing JCP IDs and serials, then explicitly save this unit and issue
   its JCP tag. Display progress such as “6 of 10 registered”.

A gallery/recognition session currently means multiple photos of **one asset**.
It must not become a silent bulk importer: ten photos could describe one device
or ten devices. A future batch workflow needs explicit per-unit boundaries.

## Matching and grouping rules

- A serial or JCP ID identifies a possible existing unit. Review before updating.
- Same brand/model/specs suggests a model group, not an existing unit. Different
  serials are expected within that group and must not be merged.
- Missing serials never identify duplicates by themselves. Check JCP tag,
  location and supporting evidence instead.
- Missing/ambiguous brand or model stays ungrouped until reviewed. Do not fuzzy
  merge similar model names or mix capacities, revisions and part numbers.
- Initially use approved category + canonical brand + exact model + reviewed
  variants to suggest grouping. Store a stable template ID after approval,
  so correcting a model name does not silently move assets between groups.
- Template edits affect future drafts. Existing records need a preview of
  changes, explicit selection, confirmation and an audit record for updates.

## Performance and implementation order

Start with an expandable grouped view of already loaded asset summaries. Use a
Map to aggregate in one pass, memoize by asset/filter revision, paginate groups,
and fetch unit details/photos only when expanded. Do not call AI, download full
photos, or issue one backend request per unit to build group counts. Counts
must identify their scope (current filter/site versus entire register).

Add “another of this model” next, with the reset rules above and existing
permissions. Add persisted templates only after the Apps Script schema and
permission checks are agreed. Quantity stock should be a later, separate step
with transaction history and safeguards against negative counts.

Before release, verify that grouping preserves total asset counts, permissions,
search by serial/JCP tag, per-unit audits and history; that blanks and conflicting
models stay separate; and that adding another unit never inherits a serial or
photo. Keep normal list/grid views available.
