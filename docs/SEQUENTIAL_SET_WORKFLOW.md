# Sequential linked assets and durable saves

Implementation branch: `feature/sequential-set-workflow`, based on `main` at `f930577`.
Scope: `docs/V27_IMPLEMENTATION_HANDOFF.md` on `docs/implementation-handoff-2026-10-21`.
Frontend **2.7.2** was deployed with explicit approval on 2026-10-21. Firebase Hosting version: `ab466fda15b3e8b7`; previous version: `48f33716821493cc`. All 32 published files were verified through the Hosting API, and the live `api-config.js` hash was preserved exactly. Direct website checks were blocked by environment network policy. The Apps Script changes have **not** been deployed; the owner must complete the backend steps below.

## Workflow

The current HTML, CSS, scanner, permissions, manual fields and photo pickers are retained. The register defaults to one row per physical item. Existing grouping is an explicit opt-in view; its older batch tools remain available there for compatibility.

Add/Edit has an optional linked-asset selector: search by model/name, JCP tag or serial; scan a tag photo; inspect the selected item; remove a link; or choose **This asset starts a set**. Selecting a similar model never selects an existing physical item automatically. Details show linked members and their parent relationships.

For set work: scan, review, **Save and continue**, set overview, scan/add the next component, then **Finish set**. The overview includes confirmed existing members and locally pending items. Placement and set context carry forward. **Same model** explicitly copies shared product fields, stripping unique specification identifiers; a fresh item has a blank serial and fresh photos. Each save creates one physical record. The first item is the root, with no extra container record. Components resolve the root's actual backend asset ID before submitting their link.

Staff/Admin creates and detail-photo attachments are persisted in IndexedDB before leaving the form. Ordinary creations retain the QR/detail destination when confirmation arrives and the user has not opened another dialog; only set work receives the extra set overview. Existing edits and Guest onboarding retain their foreground save flow and permissions. Do not claim Guest saves or existing-asset edits are offline queue operations.

## Reliability and performance

- Queue scope includes API endpoint, signed-in username/email and role; tokens are read at send time and never stored in operations. Logout hides/pauses that user's work; sign in as the same user to reconcile it. Saved operations remain as a local set history. Clearing browser/site storage removes unsent work.
- States are **Saving details**, **Uploading photos**, **Saved**, and **Retry**. Global pending count opens affected items. A server-confirmed asset with unfinished photos remains pending. Mobile suspension/closing the app can pause processing; this is not an operating-system background uploader.
- Each metadata request freezes its reviewed payload and stable operation ID before transmission. The existing `AssetBatches` ledger reconciles timeouts, partial writes, refreshes and repeated submissions. The iframe sends exactly one request ID, preserving the operation ID across retries.
- A failed prerequisite blocks dependent components, without submitting a dangling link. Backend validation checks duplicate serials, set membership, parent existence, cycles, role and review timestamps. Parent removal is blocked until its linked components are removed. Previously saved items remain intact.
- **Retry / reconcile** reuses the operation. **Review draft** is offered only after `BATCH_NOT_STARTED`, which confirms the backend did not reserve/write the operation. An uncertain save cannot be edited into a different request.
- Only one queue processor runs per endpoint/user scope across tabs using Web Locks. Ready metadata is drained before photos; photo concurrency is one and new photo requests pause on the scanner route. An already transmitted request cannot be preempted. Authentication/permission errors pause the processor until explicit retry after sign-in.
- Raw photo blobs are persisted first. Compression runs later, once per pending photo; prepared bytes are persisted and reused on retry. A stable actor-scoped photo operation ID and deterministic Drive names reconcile lost replies and partial writes without duplicate image rows/files. Completed retries do not restore an old main photo over later edits. Original high-resolution barcode/OCR inputs remain available; storage compression does not replace sensor-resolution capture.
- Initial summary sync is paged in batches of 200, using stable asset-ID cursors and including the existing list fields. Cached summaries remain usable. Nonimage details prefetch in batches of 12 when scans, visible detail reads and metadata saves are idle. Auth-scoped detail keys, response epochs and timestamps prevent stale responses from replacing newer changes. Private operational fields are excluded from persistent detail caches; logout clears detail caches.
- Queue updates merge affected records without a full-register read or replacing an open form. The ordinary register reconciles rows by asset ID, preserves unchanged DOM rows and loaded thumbnails, and keeps the visible scroll anchor. Photos update the image section without overwriting current metadata. Image tiles remain visibility-driven; incomplete cached galleries show a loading/retry state. Barcode workers retain their initialized decoder after successful scans and are terminated on cancellation/timeouts. Dictionaries remain reused by the existing recognition module.

## Owner's Apps Script update steps

The owner must apply these backend steps; the frontend-only release did not execute them against production.

1. Back up the existing Apps Script project and linked spreadsheet. Preserve Script Properties, deployment access and execution identity. No new API keys or permission scopes are required.
2. Replace **both** `Code.gs` and `AssetGroups.gs` from this branch. Keep the existing manifest and existing configuration; do not replace credentials or live asset data with fixtures.
3. In the Apps Script editor, run `setupAssetGrouping()` as the project owner. It additively ensures the existing `AssetBatches` retry ledger and asset columns, including the new `parent_asset_id`. It does not create a container asset. Preserve existing retry rows; deleting them can prevent safe reconciliation.
4. Create a new Apps Script web-app version and update the owner's chosen test deployment using its existing access policy. The owner controls Apps Script deployment. Verify bootstrap/sync reports `features.sequential_saves: 1`; it stays disabled until the required schema exists. Existing deployments keep the foreground workflow.
5. On an isolated test spreadsheet/Drive folder, verify one root and one component, refresh after an uncertain save, retry a failed photo, sign-out/sign-in recovery, duplicate serial rejection, and parent-removal safeguards. Check unchanged Sheets/Drive permission boundaries. Do not use production asset records for these checks.
6. Frontend `2.7.2-sequential-sets-1` and its service worker are deployed. Update the backend to the matching `2.7.2` source version. Future production deployments require explicit approval. No Apps Script deployment was performed here.

## Validation and limits

Validated locally: 89 unit/backend/transport checks and 52 browser-runner tests (51 scenario subtests plus their parent), with no failures or skips. Frontend and Apps Script syntax checks and `git diff --check` also passed.

Run from the repository with Node.js 24:

```sh
npm ci
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
for file in public/*.js; do node --check "$file" || exit; done
for file in apps-script/*.gs; do node --check < "$file" || exit; done
```

The tests execute real Apps Script business rules with an in-memory spreadsheet and synthetic Drive files, plus the real frontend in desktop/mobile Chromium. They cover offline recovery, parent dependencies/cycles, duplicate serials, stable iframe IDs, partial/lost writes, safe photo replay, permissions, barcode/OCR/manual-edit regressions, and camera/gallery paths. They do not prove production Google service availability, live Drive semantics, OCR/Groq credentials/quality, iOS/Android suspension behavior, quota limits, physical cameras or real phone performance. Verify those on the owner's isolated deployment before approving production release. Web Locks and IndexedDB are required for durable saves; failed local persistence keeps the original form open.

Suggested PR title: **Add sequential linked-asset registration with durable local saves**.

Suggested PR description: Preserve the existing AssetHub screens while registering linked sets one physical item at a time. Add durable user-scoped saves, dependency-safe links, idempotent metadata/photo retries, progressive cache loading and reusable barcode workers. Default the register to individual records while retaining opt-in grouping. Requires the owner to update both Apps Script files and run `setupAssetGrouping()`; frontend 2.7.2 was subsequently deployed with explicit approval; Apps Script deployment remains with the owner. Include the final test counts from this branch when opening the PR.
