# Complete asset workflows — 2.9.0 preview

Build `2.9.0-unified-assets-1` implements the approved generic asset design. This change is prepared for review; neither Firebase Hosting nor Apps Script has been deployed.

## Fields and existing records

No existing field or record is removed. `asset_name` is an optional column appended to Assets, separate from category, brand, model and serial. Existing unnamed assets keep a product/asset-ID fallback. Asset IDs, creation/update metadata, source references, retirement data, legacy set membership, custom values, private information, images and history remain available. Old writers preserve the added name and existing relationship columns.

The same field definitions drive manual/photo registration, scan results, Edit and full comparison: name, category, brand, model, serial, specifications, site, area, exact location, assignment, status and main asset. Movement notes apply to placement changes. All configured custom fields remain available, including required fields and controlled select/boolean/date/number types. Mobile number, registered owner, account number and amount paid remain Staff/Admin only and use AssetPrivate; public activity logs and detail caches do not contain these values. Record metadata is read-only. Move and photo dialogs include expandable record information; full editing remains in the asset editor.

Comparison shows existing values and an editable proposed value for every writable field. Editing a value selects it for application. Untouched conflicts default to keeping existing information. Empty proposals do not silently erase values: clearing requires selection of the empty value. Custom and private fields follow the same choice rules. Source evidence and OCR conflict validation are retained.

## Pages and entry points

| Page | Behavior |
| --- | --- |
| Scanner | OCR capture or Photo / manual entry; capture stays in the existing scanner. |
| Scan result | Complete asset editor, source thumbnails, specifications/evidence, placement/custom/private values, optional matching-unit rows; Save asset commits locally and opens details immediately. |
| Add / Edit | Same complete fields, optional main-asset selector, photos and serial popup. Edit can read a label into the current asset and compare it. |
| Review changes | All fields can be filled or explicitly cleared without opening another editor. Existing placement changes only when selected. |
| Asset list | Browse, search, filter and expand product groups. No add/edit/unlink controls in the list. Unit names are prominent; category/brand/model remain supporting information. |
| Asset details | Edit, matching products → Register matching units, linked assets → Add linked asset, existing movement/maintenance/photo/history actions. |
| Linked-asset confirmation | Optional Yes / Not now, then OCR label scan or photo followed by manual entry. Carries main asset, placement and applicable shared custom information; unit/private identifiers and photos are not copied. |
| Pending saves / Drafts | Secondary task that preserves the interrupted form, photos, focus and scroll. Completing an earlier failed scan returns directly to the interrupted task. |

Product groups are a view over independent physical records, usable for any category. Counts are derived from records, not a mutable quantity. Names and serials never define a product group; different product specifications remain separate. Incomplete descriptions are visibly unconfirmed. Product grouping is separate from `parent_asset_id`, which points to a main asset and does not merge or move its linked assets.

Register matching units copies only product and placement defaults. Names, serials, private details and photos start empty. Each extra row can override placement, status, specifications and custom values, and has its own private information and photo picker. Up to 25 units persist in one local IndexedDB transaction; server operations remain independent so an individual rejection can be reviewed without resubmitting accepted units. Required per-unit information and duplicate serials are checked before local submission.

## Background work, cache and recovery

Save completes after durable device persistence. Metadata drains ahead of photo compression/upload. Success does not interrupt the next task; failures are surfaced with review/retry actions. Editors expose Review background saves when relevant. Changing pages dismisses an old floating notification while its pending item remains available. Nested pending/review dialogs retain the original DOM and selected Files. Browser Back closes a preview/editor/detail before leaving the current page; navigation flushes unfinished drafts.

Unsubmitted form and scan drafts use a separate IndexedDB store, scoped to endpoint, actor and role. Photos and entered dirty private fields can be part of that actor's draft/pending operation; read-only private data is excluded from public caches and passive draft copies. Tokens are read at request time and are never stored in a draft or operation. Account/scope changes discard old active views and recognition state; other actors cannot see or send those drafts through the application.

A newly registered asset opens using composed local fields, custom/private edits and its own photo previews, without waiting for getAsset or an image download. Server acknowledgement replaces the temporary ID and resolves dependent links. Photo acknowledgement updates the composed detail rather than invalidating its entire cache. Revisions and immutable operation IDs reconcile uncertain requests. Old version-1 requests retain their original payloads/fingerprints during queue migration.

Serial fields have a small barcode button opening a separate dialog. Exactly one non-URL, non-AssetHub identifier is accepted automatically, with its leading zeroes and case intact. Closing/detecting stops camera tracks, including late camera requests. Manual/barcode values override later OCR suggestions. Browser BarcodeDetector is used when available, with the existing local decoder as fallback; camera denial leaves manual entry available.

Thumbnails open a separate preview with main-image choice, navigation and zoom. Main choice is independent from serial-label/evidence classification. Pending choices wait for actual uploaded image IDs. Delayed uploads and replay cannot replace a newer main selection. Existing Admin Replace/Delete permissions remain in the detail viewer.

## Owner setup and future rollout

1. Review this branch and validate with isolated copies of the Sheet and Drive data.
2. Replace **both** `apps-script/Code.gs` and `apps-script/AssetGroups.gs` in the test Apps Script project. Existing Script Properties and service configuration are retained.
3. Run **`setupAssetGrouping()` once**. It only ensures missing columns/sheets, including optional `Assets.asset_name`, AssetPrivate and the existing retry ledger. Do not run a schema reset, delete old columns or clear AssetBatches.
4. Publish a new version to an isolated test Web App deployment. Verify bootstrap/sync reports backend `2.9.0` and `features.unified_editor: 1` before expecting the new forms. Older/unprepared backends retain the existing editor.
5. Test registration, full-field comparison, required custom values, links, matching units, serial camera popup, main-image selection, private permissions, interrupted failure review and reload recovery with representative devices.
6. Production Apps Script and Firebase releases remain separate future actions. This PR does not deploy either service.

Rollback retains all additive columns and retry ledgers. Older frontends cannot interpret the new `editor-v2` queue scope; pending new-format work pauses until the matching frontend/backend returns. Keep the previous Hosting/App Script versions. A Hosting rollback does not undo saved Sheet changes or Apps Script deployment.

## Validation

Validation: **139 unit/backend checks** and **92 browser TAP tests** passed. After final reference/name display refinements, 19 targeted browser TAP tests also passed.

Automated tests use synthetic data, actual Apps Script functions over in-memory Sheet primitives, and Chromium on desktop/mobile layouts. They cover additive names, old-client preservation, complete reconciliation and deliberate clears, duplicate/cycle/stale validation, catalog repair, private separation and replay, generic grouping, atomic local registration, photo dependency ordering, delayed main-image protection, draft reloads, exact serial entry/camera cleanup and return to an interrupted form. Live OCR/AI quotas, physical cameras and production data are not exercised by these tests.
