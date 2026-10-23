# 2.9.0 — Hosting deployed (2026-10-23)

- Preserve all existing fields and add optional unit names across lists, details, search, labels and exports.
- Share complete registration/Edit/comparison fields, contextual accepted choices, serial popups and compact photo previews.
- Register generic matching units with individual information; keep the list browse-only and main/linked references independent.
- Recover scoped unfinished drafts and photos, return from failure review to the interrupted task, and open newly saved details from local data.
- Retain old retry fingerprints and private permissions; protect main-image choices from delayed uploads/replay.
- Deploy frontend 2.9.0 build `2.9.0-unified-assets-2`; stop the serial-popup camera synchronously on close. All 35 public files verified; production backend configuration preserved. Apps Script deployment/setup remains owner-managed.

# 2.8.1 — Hosting deployed (2026-10-22)

- Return locally saved scans to the asset register before offering linked capture; keep background saves running.
- Preserve unfinished scan reviews across navigation. Start explicit linked/update scans with fresh evidence and the correct target.
- Open one camera per capture, release obsolete streams, retain choices after native camera cancellation and remove the old drawer before photo-only manual entry.
- Ignore late detail/cache/image/tag/review responses and local-save acknowledgements after changing screens. Bind detail actions immediately without waiting for images.
- Refresh the static app cache with build `2.8.1-navigation-1`; retain the 2.8.0 backend contract and durable queue scope. No Apps Script changes required.

- Report frontend 2.8.1 separately from the 2.8.0 API compatibility target so frontend patch releases do not falsely flag an unchanged backend as incompatible.

# 2.8.0 — Hosting deployed (2026-10-22)

- Save new assets directly from the original recognition result, retaining evidence, manual corrections, conflicts, barcode approval, placement and required custom values.
- Replace set names/overview/Finish set with one optional main-asset reference. Add confirmation and OCR/photo-only entry choices; unknown brand/model/serial may remain blank for unlabelled devices.
- Integrate icon-labelled links into details; Edit unlinks/relinks existing records without duplicating them or moving their related assets.
- Queue creates, edits, reviewed scan updates, placement, retirement and photos with server-side deduplication, dependency handling, stale-edit review and scoped recovery. Guest onboarding stays limited to its own new asset.
- Keep uploads quiet, prioritize metadata/recognition, retain cached list/detail/image behavior and add main asset references to search/report exports.
- Update both Apps Script files and run the additive setup. Preserve legacy set data. Hosting build `2.8.0-simple-links-1` was deployed on 2026-10-22; Apps Script remains owner-managed.

# V2.6 — 2026-10-16

- Explicit mobile category/brand/area dropdowns (with editable text) and site-scoped area chooser.
- Scan-to-update from existing assets, field-level reconciliation, and busy feedback for review actions.
- Progressive scan stages and visible Groq versus OCR mapping. Fixed Groq key enablement in backend startup/diagnostics.
- Better recognition of Windows About/HP Compaq 8200 Desktop PCs; stronger matching evidence requirements.
- Select primary image in gallery and display full-size photos in gallery tiles.
- Slow-save feedback and delayed background refresh to reduce perceived stalls.

---

## V2.5 (2026-10-14) — Preview candidate

- System Setup async operation indicators and feedback
- Maintenance grouped card UI + quick status filters
- Scan-result-first reconciliation and explicit merge comparison
- Optional AI field assignment with evidence checks and deterministic OCR parser improvements

## V2.5 — 2026-10-14

- Fixed login scoping bug and first-boot background sync race.
- Implemented expected-asset audit checklist via protected backend roster.
- Added readable report views and full 22-column Assets CSV.
- New A4 landscape print/PDF layout.
- See RELEASE_NOTES.md for deployment and tests.

# JCP AssetHub — Release history (current release V2.5)

## V1.9.0 (original technical baseline)

## Mobile reliability & maintenance workflow

- Reworked POST transport for phone reliability. Login, OCR and write actions now submit through a hidden form/iframe transport and return to AssetHub with `postMessage`, while normal GET reads still use `fetch`.
- Added Apps Script iframe reply support with `XFrameOptionsMode.ALLOWALL` for the mobile-safe POST transport.
- Scanner now separates two camera experiences:
  - **Live Scanner** for QR/barcode watching.
  - **Take Label Photo** opens the phone's native image-capture interface for a natural shutter/retake/accept flow before OCR.
- Large phone photos are resized before OCR upload to reduce transfer time while preserving label readability.
- Maintenance now has an Assets-style searchable list, date filter, advanced filters and sortable desktop/mobile views.
- Maintenance records now expose an explicit **Edit** action for authenticated Staff/Admin users, including from asset detail history.
- **Report Issue** now uses a searchable asset picker instead of a long select list.
- Removed the unrelated **View assets** action from Recent Activity.
- Background refresh is quieter: cached/visible data remains on screen and background work is shown as a small `Syncing` system-status state instead of a top blocking spinner.
- The top loading indicator is reserved for true blocking loads where the user has no usable data yet.
- Startup immediately prefetches/synchronizes common data so later navigation is more likely to be instant.
- Mobile bottom navigation makes **Scan** the primary visual action.
- System Diagnostics now reports whether the latest API call used `fetch` or the mobile-safe `iframe` transport.

No new Google Sheet tabs or columns are required.

## V2.3 (2026-10-14) — Preview candidate

Mobile-first navigation, scanner, asset disclosures, embedded audit scanning, server-side snapshot and completion safeguard, safer API configuration, and 768px list overflow correction. See `RELEASE_NOTES.md`. Requires both frontend and backend deployment and a configured `/exec` endpoint.

## V2.7 Preview — 2026-10-19

- Added generic Groq schema extraction with field-level text evidence, typed identifiers, arbitrary equipment specifications and fallback to OCR.
- Added source-aware multiple-photo recognition with explicit conflict review and editable proposed fields.
- Added typed, conservative match suggestions and explicit scan-to-update review with safe specification combination.
- Retained V2.6 desktop barcode scanning and all unrelated asset-management screens.
- Automated local unit, mocked backend and mobile browser test coverage; **live deployment validation pending**.
