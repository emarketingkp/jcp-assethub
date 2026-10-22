# Simple linked assets and background saves

Implementation follows `docs/V27_IMPLEMENTATION_HANDOFF.md` and the subsequent approved mockups. The later decisions replace the old set overview, set name, Finish set and two-step scan registration. Production deployment is not authorized.

## Agreed scope

- Keep the current screens, permissions, camera capture, barcode fallback, OCR evidence/conflicts, manual overrides and reconciliation controls. Save new assets directly from the existing scan result, with placement and required custom fields on that result.
- Each physical record has one optional `parent_asset_id`. Any device type can be a main or linked asset; allow nested direct links, prevent self-links/cycles, and never infer a root from old `set_id`/`set_name` data. Preserve those older fields.
- After saving a new main/standalone asset, ask **Add a linked asset?** Yes shows only **Scan label with OCR** and **Take asset photo**. Photo capture opens the existing manual form with the photo and main reference attached. Category and placement identify unlabelled devices; brand/model/serial may be blank in photo-only manual entry. Not now closes the prompt and does not cancel the save.
- Carry the selected main and editable placement to the next registration. Clear serial, unique identifiers and photos. Common model fields are copied only by an explicit same-model action.
- Details integrate a clickable Main asset reference, direct linked members and one Add linked asset action. Normal Edit changes/removes the reference; linking never duplicates an existing record or changes its placement/history. Use labelled icons in details, leaving scanner-result icons/layout unchanged.
- Persist metadata, raw photos and reviewed scan evidence before navigating away. Metadata, existing edits, scanned updates, placement and photo attachments use a scoped durable queue with stable operation IDs. Quiet progress is available from a pending count; only actionable failures notify. Pending is distinct from confirmed.
- Resolve queued main dependencies to actual server IDs. Deduplicate/reconcile retries and lost replies on the server; reject stale edits and duplicate serials. Compress photos once; drain metadata before bounded background uploads; give current recognition priority. Refresh/reopen resumes the same operations. Session expiry pauses work and hides drafts until the same user signs in.
- Retain cached summaries, paginated loading, lower-priority nonimage detail batches, visibility-driven images and reusable barcode workers. Merge affected records without replacing an open form or reloading the register. Reject responses from an earlier login/session or older asset revision.
- Search and reports/export include main asset ID/name, counting every physical record once. Movement/maintenance/audit/retirement affect their own record; retirement retains links and does not retire children.

## Delivery

Update both Apps Script files and document additive setup steps. Keep live configuration and records untouched. Run unit/backend and desktop/mobile browser regressions with synthetic data, including recovery, duplicate/stale writes, photo-only entry and preserved scan validation. Bump frontend/backend/build/service-worker versions together. Provide a PR title, description, validation and backend instructions; no production deployment.

## How it works

Build `2.8.0-simple-links-1` is prepared for review and is not deployed. `features.asset_links: 1` enables the new workflow only when both matching backend files and the required schema are present. Older endpoints retain their existing foreground/legacy workflow; old queued batch requests can still reconcile on the updated backend.

The existing `AssetBatches` sheet is also the single-record operation ledger. New requests freeze their kind, reviewed fields, expected record timestamp and request ID. Creates reserve one physical ID; updates/linking/reconciliation/retirement record the intended patch before writing it. Retrying repairs incomplete custom values, movement and activity records without duplicating them, and completed replay returns current data without reapplying old values. A failed prerequisite blocks children until a real parent ID is returned. Conflicting new edits wait for reconciliation. Older create/batch clients also respect reserved IDs/serials; the one-time legacy importer waits for pending metadata to reconcile. Queued and older photo routes share the asset write lock so an image touch cannot overwrite a concurrent metadata change. An operation rejected before it starts can be reviewed; uncertain requests keep their frozen payload.

Only `parent_asset_id` represents the new relationship. Linking never writes legacy `set_id`/`set_name` or changes the parent record. The normal Edit form may remove/reassign a reference while retaining the item's children, placement and history. Existing legacy references remain readable separately; no root is inferred. Legacy Merge refuses a source that still has main/child references: review/reassign those references before merging so they cannot dangle. Retirement leaves children active and keeps references/history.

Queue scope combines endpoint, account and role. Sign-in tokens are read at send time, never stored in an operation. An anonymous browser Guest session has a random onboarding proof, scoped to its own newly created unlinked assets; the server stores only its hash. The proof can renew a short-lived upload grant for that same creation, including after a lost reply/reopen, but cannot edit/link existing records. Guest upload grants and private account fields are not persisted in operation results. Explicit sign-out ends the Guest draft identity; switching accounts hides/pauses earlier work. Clearing site storage removes unsent work.

Metadata is drained before a background photo; only one photo request runs per user/endpoint across tabs. Compression runs after local persistence and is reused on retry; metadata added during compression takes priority. New photo requests pause during active recognition, with sensor-resolution originals still available for OCR/barcodes. Photos continue on an idle scanner. Already transmitted requests cannot be preempted, and browser/phone suspension may pause the queue.

A small pending count opens progress for details and photos separately. New drafts are visually distinct from confirmed register rows. Only failures create a nonblocking notification. Duplicate/stale rejections retain the draft/photos and, for scans, the original source observations, manual overrides and conflict choices. Stale edits compare latest and draft values before a reviewed replacement request is saved. Session expiry pauses writes and hides pending-item details; the same account can sign in to resume. A different account cannot send those drafts.

## Owner's backend setup and isolated acceptance

1. Back up the Apps Script project and spreadsheet. Preserve Script Properties, existing retry records, access policy, execution identity and Drive folder configuration. No new keys, advanced services or OAuth scopes are required.
2. Replace **both** [`apps-script/Code.gs`](../apps-script/Code.gs) and [`apps-script/AssetGroups.gs`](../apps-script/AssetGroups.gs). These files both change in 2.8.0. Copying only one file is not a supported update.
3. Run `setupAssetGrouping()` as the owner. This additively ensures `Assets.parent_asset_id` and the existing `AssetBatches` ledger. It preserves rows, set fields and retry records; it creates no container asset or set name. Run even if an earlier sequential-save setup was performed; no data migration/rewriting is needed.
4. Publish a new version to an **isolated test** Apps Script deployment with copied Sheets/Drive and the existing permission policy. Verify bootstrap/sync version `2.8.0` and `features.asset_links: 1`. The owner controls Apps Script deployment; no backend or Hosting deployment was performed here.
5. Against that isolated backend, check ordinary/direct scan registration; two-source conflicts; required custom information; root plus photo-only child; offline/reload recovery; duplicate serial and stale-edit review; photo retries; expired sign-in/account switching; independent movement/retirement; existing-link Edit; legacy records and CSV exports.
6. Preview the frontend using the isolated endpoint, then check Android/iPhone camera/gallery capture, memory/storage limits and suspension behavior. A preview frontend using the production API writes production data, so use copied data for these tests.
7. Production Hosting and Apps Script release both require separate explicit authorization. Preserve the previous Hosting and Apps Script versions for rollback; do not delete or reset additive columns or the retry ledger on rollback.

## Validation

Run with Node.js 24 and the pinned lockfile:

```sh
npm ci
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
for file in public/*.js; do node --check "$file" || exit; done
for file in apps-script/*.gs; do node --check < "$file" || exit; done
git diff --check
```

Final local validation: **117 unit/backend/transport checks** and **68 desktop/mobile browser scenarios (69 TAP tests including their parent)** passed. Frontend/backend syntax checks and `git diff --check` also passed. The 1,000-record search benchmark stayed under its 150 ms p95 budget at 4× CPU throttling. `node --test --test-isolation=none tests/*.test.js` reports the individual unit-check count; `npm test` also passes. The tests use the real frontend and actual Apps Script business rules with in-memory Sheets and synthetic Drive/files, not production records or provider credentials. They do not prove real OCR/Groq availability, Google quotas/Drive behavior, physical-phone image quality or uploads while the app is closed. Long-term server-side OCR provenance/search remains outside this release; reviewed evidence is retained locally for pending recovery, and the asset retains its reviewed fields/specifications and uploaded source photographs.
