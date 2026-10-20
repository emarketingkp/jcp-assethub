# Faster register and multiple-item entry

Build: `2.7-fast-entry-1`. Based on the merged equipment grouping change.
Frontend changes only; no new Apps Script deployment, schema, permissions or
dependencies. Production Hosting has not been changed by this work.

## What changed

- Search text, product grouping keys and group totals are indexed once per
  asset snapshot. Sorting is cached until the assets or sort choice change.
  One numeric-aware `Intl.Collator` replaces constructing comparison options
  for every pair; date sort values are computed once per row.
- Broad searches keep groups compact. A query matching up to 25 physical items
  opens matching groups automatically. Explicitly opened groups stay open.
  Automatically opened search results do not become permanently expanded after
  clearing or widening the query. Counts and filters still cover all loaded
  matching items; 50 outer rows and 25 units per expanded group remain the
  initial rendering limits.
- Asset sync merges changed summaries with a map rather than copying and
  searching the entire array separately for every incoming item. An empty
  asset delta keeps the existing snapshot and its search/sort caches.
- First visits start bootstrap and initial sync together rather than waiting
  for bootstrap before requesting the asset snapshot. Opening an empty register
  during this initial sync reuses that request. If sync fails, normal list
  loading remains available. Returning visits still show cached data and
  revalidate with the server. No API response is accepted as a write permission;
  server checks are unchanged.
- Batch save success renders the register once rather than twice.
- Same-model and equipment-set fields now use the existing local suggestions
  for category, brand and model. Each component's model suggestions use that
  component's brand. Selecting a suggestion is explicit; unknown values remain
  editable. This adds no OCR/AI or Apps Script requests.
- Same-model entry includes **Paste a serial list**. Use one serial per line,
  up to 25. Internal blank lines represent units without serials; trailing
  blank lines are ignored. Long numeric strings and leading zeros remain exact.
  Commas are not interpreted as separators. Oversized lists/serials show an
  error instead of truncating data. Replacing populated rows asks for confirmation.
- Serial rows are more compact. Next/Enter advances to the next serial and
  finally focuses Review; it does not submit the form. Serial inputs disable
  spelling correction and automatic capitalization. Existing duplicate checks,
  review confirmation and saved-request retry protections still apply.
- App build metadata and service-worker cache version are updated together.

## Measurements and validation

Local Chromium with a 390 × 844 viewport, 1,000 synthetic records in 250 model
groups and 4× CPU throttling. Device-name sorting was selected; 40 measured
searches alternated broad, model, serial and empty queries after five warmups.
Measurements include synchronous search handling, DOM changes and forced layout.
They exclude network, startup and physical-phone performance.

| Measurement | Before | After |
| --- | ---: | ---: |
| Search and layout median | 209 ms | 48 ms |
| Search and layout 95th percentile | 393 ms | 67 ms |

The before/after improvement includes the intentional reduction in automatically
expanded rows for broad queries. It is not an isolated search-algorithm benchmark.
The browser regression repeats this workload with a 150 ms p95 budget and checks
that searches make zero API calls. Results depend on machine load.

Read-only public production checks on 2026-10-20 observed:

- Hosting `version.json`: 0.26 seconds, build `2.7-still-barcodes-1`.
- Apps Script bootstrap: 6.46 seconds, about 28 KB.
- Apps Script sync with a current cursor: 7.96 seconds, about 24 KB and zero
  changed assets.
- Both backend replies advertised `features.asset_groups: 1`.

These were single concurrent observations from this cloud environment, not a
latency distribution or a phone benchmark. No token, asset contents, private
records or response bodies are committed. No production writes were performed.
The 6–8 second observations demonstrate that Apps Script/Sheets latency remains
material even when a sync returns no changed assets. Frontend measurements do
not establish save speed or OCR/provider accuracy.

Validation commands:

```sh
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

The unit/backend suite has 56 passing checks. The browser suite has 38 passing
scenarios (39 TAP tests including the parent). Added coverage checks overlapping
startup reads in either completion order, shared-snapshot reuse and fallback, exact-string
serial paste, replacement cancellation, oversized lists, Next/Enter behavior,
component-specific model suggestions, search/sort invalidation after sync and
the 1,000-record performance budget. Existing scanner, photos, offline,
permissions, grouping and retry regressions remain enabled. All frontend and
Apps Script syntax checks and `git diff --check` pass.

## Release and real-device acceptance

Use the isolated backend/Hosting procedure in [GROUPS_AND_SETS.md](GROUPS_AND_SETS.md).
The already-updated grouping backend is sufficient; these changes require only
a reviewed frontend release. Stage the correct `/exec` URL in deployment config
outside the repository, which deliberately keeps `api-config.js` blank. Keep the
previous Hosting release for rollback. Production deployment still needs approval.

On a staff phone, check the first visit and a returning visit, broad and exact
searches, a 25-item blank/different-serial batch, serial paste, keyboard Next,
one mixed PC set and lost-response retry. Check desktop entry too. Time save
acknowledgement separately from photo upload and OCR. Use copied Sheets/Drive
for writes; a Firebase preview using the live Apps Script URL writes live data.

## Remaining priorities

- Profile individual backend sheet reads and dashboard/reference computation
  against a representative copied database. Unchanged-sync responses still
  include dashboard/reference work and can be relatively large. A future
  versioned bootstrap/sync contract could avoid repeated work and reduce first
  visits to one read. Shared caches must not contain staff/private responses or
  allow stale authentication. This release does not introduce a backend cache.
- Measure actual save, photo and OCR latency on Android/iPhone networks before
  setting a staff-facing time target. Parallel startup reads remove a sequential
  wait but still use two requests and may compete for Apps Script resources.
- Consider a reviewed “scan one example, add more identical units” shortcut.
  It must keep per-unit serial/photo evidence separate and handle a photo-save
  retry without duplicating units; it is not included here.
- The register is still limited to the existing 1,000 loaded summaries. Larger
  inventories need server paging/search. This work does not claim unlimited
  scaling or recover historically damaged identifiers.
