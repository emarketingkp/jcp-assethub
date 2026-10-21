# JCP AssetHub — implementation handoff

Updated 21 October 2026. The user has approved building the workflow and optimizations below. Implementation has NOT started; recent work only produced standalone mockups. Begin implementation in a fresh session, using this document as the agreed scope.

## Repository and release boundaries

- Repository: emarketingkp/jcp-assethub. Existing workspace: /workspace/jcp-assethub.
- This handoff is published on docs/implementation-handoff-2026-10-21, based on origin/main. Fetch and inspect latest main before creating an implementation branch; this documentation branch contains no application implementation.
- App: Firebase Hosting frontend; Google Apps Script backend with Sheets/Drive; OCR.Space and Groq recognition. Preserve working V2.6/V2.7 features, desktop behavior and existing permissions. Do not rebuild the application.
- Public site: https://jcp-assethub.web.app. Last verified deployed frontend was 2.7-fast-entry-1. Progressive connection work was reported merged but was not verified deployed. Recheck source/release state when necessary.
- User handles Apps Script deployment. Assistant may prepare Firebase deployment, but DO NOT deploy this release to production without fresh explicit approval. Do not expose tokens/API keys or modify live asset records for tests.
- Provide a title and description for every PR, validation results, outstanding limitations, and precise Apps Script update/setup steps if applicable.

## Authoritative UI direction

Use the actual current app HTML, styles and templates, then enhance in place. The user rejected unrelated redesigned layouts, extra Add Asset chooser steps and automatic grouping of register rows.

Optional linked-set input belongs inside the existing Add/Edit form: “Linked asset / set (optional)”, searchable by name/tag/serial, with Scan tag, selected asset details, and Remove. Offer “This asset starts a set.” Each physical item remains a normal searchable register row, with its own identifiers/history. Details on any member show the linked tree; do not create an extra container asset record.

Archival mockup references, only if retained in the workspace (these files may not exist in a new session; the written requirements here and the current repository UI are sufficient to proceed):
- /workspace/artifacts/jcp-current-ui-enhancements-mockup.html — accepted visual baseline, Current/Enhanced comparison.
- /workspace/artifacts/jcp-scanner-result-set-mockup.html — scanner-result module appearance only.

IMPORTANT: The latter mockup demonstrated bulk registration, but the user subsequently replaced that behavior with the sequential flow below. Do not implement its bulk-save behavior as the final workflow. There is no need to reproduce whole-app mockups; keep future previews focused on the affected page.

## Latest agreed flow: save one asset, continue through a set

Ordinary asset registration keeps its usual flow. For a set:

Scan → review details → Save and continue → set overview → scan next component → repeat → Finish set.

The set overview lists registered AND pending items, with Scan next component, Add manually and Finish set. Each save registers one physical asset, linking it to the selected set. Carry set and placement forward; clear serial and other unique identifiers for each new item. Explicit “Same model” can copy common fields. Never silently infer a physical match from model similarity or clone unique identifiers.

Save and continue must not wait for network/photo uploads. Persist the draft and photo data locally first, then navigate immediately. Staff can start the next scan while work continues. Keep already saved items if staff stop partway through. This extra overview is only for set work.

## Agreed optimizations and reliability requirements

1. Durable, user-scoped local queue (e.g. IndexedDB), separate metadata saves from photo uploads. Item states: Saving details, Uploading photos, Saved, Retry. A small global pending count links to affected items. Never label a pending operation Saved.
2. Metadata/interactive recognition take priority. Limit concurrent background photo uploads so they do not compete with current scans. Compress photos once and reuse the compressed version for recognition/upload where appropriate.
3. Root/set dependencies: components may queue before the main asset is confirmed, but their server links must wait for the actual backend asset ID. Use local operation IDs internally; do not invent permanent IDs or create dangling links.
4. Idempotent backend writes and safe retry/reconciliation are essential. Repeated taps, refreshes, timeouts or retries must not create duplicates. Persist draft state, resume pending work on reopen, and show actionable failures. Mobile OS/browser suspension can pause work; do not promise uploads continue after closing the app. Expired authentication pauses writes without weakening permissions.
5. On first load, fetch all list-summary fields in batches: identifiers/name/brand/model/serial/site/area/assignment/status and other default list fields. Show cached summaries immediately. Fetch remaining nonimage details in lower-priority background batches until cached. Give visible/open asset details priority. Scope sensitive caches by user/permissions and clear appropriately on logout.
6. Lazy-load images only when visible or needed by the open detail. Avoid re-fetching the whole register after create/edit/upload. Merge returned changes into caches and update only affected rows/fields, preserving scroll, open details and typed values. Show loading/retry indicators only on missing or refreshing parts, including individual image tiles.
7. Keep barcode workers/dictionaries ready across scans; avoid unnecessary startup reads or full-page reloads. Use local/barcode/OCR evidence progressively; AI is optional for unresolved fields. Retain supported OCR results if AI fails. Late recognition/background responses must not overwrite manual edits or newer saved data.
8. Preserve per-asset multi-photo evidence, manual fallback, source conflicts and explicit barcode-to-serial approval. Barcode values may be model/part identifiers. Do not fabricate asset information, merge different serials or overwrite existing records without confirmation. Check duplicates on the server, not just against the browser cache.
9. Include Take photo AND Gallery in detail uploads and the post-scan filling form. Attaching a photo there must not restart recognition. Preserve the prior sensor-resolution still capture/barcode fallback improvements and progressive connection checks.

## Execution expectations

Inspect current code, requirements/docs, backend contracts and existing tests first. Implement incrementally, preserve existing grouping functionality where still applicable while replacing the confusing automatic register grouping/entry flow as agreed. Reuse existing modules when suitable. Run meaningful regression checks for queue recovery/idempotency, parent dependencies, stale responses/manual edits, duplicates, permissions, camera/photo paths and mobile/desktop transitions. Mocked tests alone do not establish real provider availability or physical phone performance. Document modifications and unresolved real-world verification needs. No production deployment is authorized for this work.
