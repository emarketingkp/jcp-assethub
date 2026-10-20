# Progressive connection checks and AI failures

Build `2.7-connection-checks-1`, based on production `2.7-fast-entry-1`.
This change is not deployed. It needs an updated **Code.gs** and a reviewed
Firebase frontend release. `AssetGroups.gs`, schemas, Script Properties, scopes
and account permissions do not change.

## Findings

A read-only call to the production diagnostics endpoint on 2026-10-20 returned
`online`. Its provider rows said only that OCR and Groq keys were configured.
No provider request ran. This establishes configuration, not provider/model
availability, scan success or the cause of an earlier intermittent failure.
No production login, provider probe, asset write or Drive upload was performed.

The previous view also:

- Marked AI healthy even when its key was absent, and ignored AI in the overall
  health summary.
- Always marked browser cache healthy, regardless of storage access/failures.
- Checked `window.ZXing` instead of the current local Worker/WASM barcode reader.
  Merely having a native `BarcodeDetector` constructor did not prove it decoded.
- Treated QR library presence as a working generator.
- Showed access policy as a successful permission/session test.
- Coloured the last API request by latency without checking its success flag.
- Reported “Sync finished” even when sync returned failure/offline/busy.
- Replaced a known AI failure with a general online status after successful sync.
- Rendered one combined result only after all backend checks completed.

Scanning also hid AI errors behind a skipped phase, could retain a stale cached
AI-enabled flag, and could mark asset matching complete after the request failed.
The fullscreen mobile scanner covered the normal connection button.

## Resulting behaviour

The connection view updates each row independently with Checking, Verified,
Failed, Needs attention, Not tested, Not configured or Information. Rows include
check time and duration when available. Results over five minutes old are
labelled stale, not presented as a fresh success. OCR/AI rows and test buttons
are near the top. Both the normal header and the fullscreen scanner can open it.
The header says **API online**, which describes the backend request rather than
asserting all services work. Known service failures retain an Issues indicator
through subsequent successful syncs. Offline updates immediately.

| Check | Actual evidence and limits |
| --- | --- |
| Apps Script | A diagnostic response arrived. This is a GET test, not proof of iframe POST transport. |
| OCR.Space / Groq configuration | Key present/missing; never a verified connection solely from configuration. |
| Google Sheets | Required tabs exist and Assets headers can be read. No write or staff permission bypass is tested. |
| Google Drive | Configured folder metadata can be read. Upload/create/delete permissions are not tested. |
| Session | Supplied token resolves to an active Staff/Admin session. Guest access is informational; all operation permissions are not claimed verified. |
| API compatibility | Compares frontend/backend API versions. It does not claim identical frontend/backend build IDs. |
| Browser storage | Random isolated test value is written, read, removed and checked absent. Reports IndexedDB or localStorage fallback accurately. No asset cache is deleted. |
| Barcode reader | Current native/Worker path decodes a bundled Code 128 with a known value. No camera or provider. Defers when a scan already uses the reader. |
| QR generator | Library renders a nonblank light/dark canvas. Printed QR scanning is not tested. |
| Local recognition | Existing parser extracts a known model from synthetic text without provider calls. |
| Last API request | Displays its real success flag and timing as historical information, not all-service health. |

Opening the view runs local checks plus backend read checks. It does **not**
make OCR or AI inference requests. **Test OCR & AI** is an explicit Staff/Admin
operation after API/session verification:

- OCR sends an embedded generated “JCP CHECK 1234” image to the actual OCR path.
  A reply without the expected test text is a warning, not a successful read.
- AI runs the real universal interpreter with synthetic brand/model/serial text,
  the configured model, endpoint, instructions, strict schema and output budget.
  It checks the supported model and serial returned by the evidence filter.
  A valid request with missing expected fields is a warning. It does not claim
  accuracy on staff photos.
- Tests do not save assets, images or asset activity. Existing security logging
  still records denied unauthenticated/unauthorized POST requests.
- Results are shared in Script Cache for up to 90 seconds, keyed by a hash of
  service/key/model. Key/model changes invalidate reuse without exposing values.
  An in-flight marker prevents immediate repeat requests for up to six minutes
  if a request times out or dies. CacheService is best effort and can evict early;
  this is not a durable quota guarantee. No automatic retry/polling loop is added.
- The synthetic probe bypasses the normal account scan allowance internally.
  External interpretation requests cannot request this bypass. Actual scanning
  retains its account rate limit and Staff requirement. Guest OCR/add remains
  as before; new provider probes require Staff.

Rows use only timestamps, states and safe messages. No token, key, real OCR text
or real asset details are put in diagnostic results or a new browser history.

## Scan reliability changes

- `sync` now returns the trimmed `ai_ocr_enabled` configuration flag; the frontend
  refreshes and caches it. Key configuration still does not prove AI availability.
- OCR/AI request progress and results update their service indicators. OCR
  preparation failure is reported as not contacting OCR, rather than claiming a
  provider outage. Cancelled/late results do not populate the next asset.
- Staff sign-in/configuration requirements are explicit when AI is skipped.
- AI/OCR and matching failures are marked failed. A skipped/unattempted matching
  check is not marked complete. Matching failure warns to review identifiers.
- Local OCR fields/manual edits remain available when Groq fails. No suggestion
  becomes an automatic asset write; evidence and conflict handling stay intact.
- Both legacy and universal Groq calls use the same safe response parser.
  It distinguishes authorization, quota, known model/schema error codes,
  rejected requests, HTTP failures, transport failure, refusal, incomplete output
  and invalid JSON/schema. Output exhaustion is reported; the budget is not
  silently increased. There is no endpoint/model migration without live evidence.
- OCR error responses distinguish known authentication/quota/size failures where
  the response supports that diagnosis. Raw provider error bodies are not sent
  to the browser. Ambiguous failures stay generic rather than guessing a cause.
- A newer actual scan result wins over an earlier diagnostic test. Closing or
  replacing the panel stops its UI updates; it cannot cancel an already-issued
  Apps Script/provider request or undo quota already spent.

## Owner rollout and isolated acceptance

1. Back up the current Apps Script version. In an isolated project linked to
   copied Sheets/Drive, replace **Code.gs** only. Keep `AssetGroups.gs`, existing
   Script Properties and manifest scopes. No setup/migration function is needed.
2. Deploy the existing web app as a **New version**, keeping its execution identity,
   access settings and `/exec` URL. Do not create a second deployment/URL merely
   for adding these functions to the existing production project.
3. Use an isolated Hosting frontend configured for the isolated backend. A preview
   configured with the production `/exec` endpoint is not isolated for writes.
4. Sign in as Staff and open System connection. Read/device checks should fill
   independently. Configured OCR/AI must say Not tested before an actual request.
5. Press **Test OCR & AI**. This uses provider quota. Confirm real results and the
   configured model's structured-output compatibility. Try again to see the
   timestamped cached test. Check Guest denial and an expired Staff session.
6. Scan a real label on Android/iPhone. Observe preliminary OCR fields before AI,
   final per-service status and fallback when AI fails. Verify real camera/gallery,
   save, photo upload and iframe POST separately. No connection-only test proves
   those write paths, end-to-end accuracy or provider reliability over time.
7. After review, merge; the owner updates production Code.gs as above. Firebase
   production deployment still needs explicit approval. Stage the real `/exec`
   URL outside the checkout; repository `api-config.js` stays blank. Keep prior
   backend/Hosting versions for rollback. The new frontend safely identifies a
   legacy backend and disables its unavailable live-provider test button.

## Tests and performance

`npm test`: **68 passing checks**. `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
npm run test:browser`: **45 passing scenarios** (46 TAP tests including parent).
Syntax checks cover all frontend `.js` and backend `.gs` files.

New tests run real Apps Script functions in the spreadsheet harness: real-session
route enforcement, no asset mutation, credential-bound/in-flight cache reuse,
unchanged account limits, correct universal schema, OCR sample handling, provider
error redaction and distinct failure codes. UI tests exercise deferred responses,
progressive rows, quota failure, failed sync, disabled storage, real local decoder,
Guest/legacy gating, late modal responses and stale AI configuration on reload.
Existing photo, scan, grouping, duplicate, offline and desktop tests remain enabled.
The 1,000-asset search and local recognition budgets still run under 4× CPU slowdown.

No startup health polling or inference is added. The panel uses up to three backend
read requests (API/config/session together, then Sheets and Drive independently),
which can take longer than one combined call on a cold Apps Script instance.
Each request has a browser deadline. Local barcode work uses the existing bounded
Worker and loads its WASM lazily; no new decoder dependency is introduced.

## Unresolved limits

The live deployment cannot yet run these new tests. Actual Groq model/key/quota
availability and the historical scan failure remain unverified until the owner
updates Code.gs and a Staff session runs the live test. The cloud workspace has
no staff token or provider keys; credentials were not requested or copied.
Official Groq documentation could not be fetched because the environment proxy
returned 403. The existing endpoint/payload was preserved rather than assuming
an undocumented replacement fixes an unobserved error.

Synthetic tests and local Chromium are not proof of real-photo accuracy,
provider latency, Apps Script quota behaviour or physical-phone usability.
The normal GET deadline remains 20 seconds and iframe POST deadline 45 seconds;
those timeouts cannot identify which downstream hop stalled. Successful probes
are point-in-time evidence only. Cache/session state is not historical provider
telemetry. Sheets/Drive write permission and real photo uploads still require
separate explicit staff acceptance.
