# Still capture and barcode review patch

Build: `2.7-still-barcodes-1`; backend API version remains `2.7`.
Based on merged main `55af345`. This patch has not been deployed.

## Findings and changes

The previous mobile shutter saved `videoWidth × videoHeight`, which could be a
480 × 640 preview. A small label cannot regain detail by upscaling. The scanner
also selected only the first barcode and discarded non-JCP codes in universal
recognition. A warranty QR could therefore obscure a nearby serial candidate.

- `image.js` / `app.js`: mobile shutter uses `ImageCapture.takePhoto()` when
  available, with a six-second capture deadline. Unsupported devices open the
  native camera input within the original user gesture. A failed still capture
  asks the user to tap again for native capture, preserving mobile picker rules.
  The scanner no longer saves the preview as its recognition photo. Preview
  requests a modest ideal 1280 × 720; sensor still size is browser/device-dependent.
- Camera acquisition has a generation check. A camera that opens after the
  scanner closes is stopped; failed video startup also releases its stream.
- `code-scanner.js` / `barcode-worker.js`: all native observations are retained,
  then a same-origin WASM worker searches for up to eight codes. If no linear
  code was found, it makes one focused linear-only retry. Rotation and inversion
  are enabled. Image data is capped at a 2400-pixel long edge without upscaling.
  Native search gets at most 800 ms before fallback starts; the overall search
  has a five-second default budget, including load time. Cancellation terminates
  the worker; stale native results are ignored. Native and worker bitmap creation
  normally run in sequence to limit concurrent full-resolution image allocations.
- Barcode observations appear independently of OCR/AI completion, with image
  number and format. Generic identifier candidates require **Use as serial**.
  Replacing a different reviewed serial requires another confirmation. Nothing
  writes a record at that step. URL/structured codes and EAN/UPC product codes
  have no serial action; a product code can be shared by many units. JCP tags
  remain separate matching identifiers. OCR/AI cannot overwrite manual approval.
- JCP parsing accepts current 13-digit timestamp IDs (up to 16 digits), exact
  tagged IDs and `?asset=` links; it rejects embedded/partial ID matches.
- OCR keeps the previous 2 MiB binary image budget. Large images resize to 2400
  pixels, with at most two further compression passes (2000 then 1600 pixels).
  An oversized result reports an error rather than sending an unbounded upload.
  The local barcode reader receives the original file before OCR compression.
- Barcode decoding no longer depends on the unpkg scanner script. Pinned,
  licensed reader files and hashes live in `public/vendor/zxing-wasm/`.
  `zxing-wasm` and synthetic-fixture generator `bwip-js` are development dependencies.
  The optional QR-label generation CDN is unchanged.
- Firebase serves WASM with its MIME type and revalidation headers. The service
  worker build/cache changes; decoder files load lazily and enter the existing
  runtime cache after first use. Offline decoding works after a successful online
  scan; a first-ever offline scan can still use available native detection and
  manual entry. Offline record writes remain unsupported.
- No Apps Script code, permissions, authentication, stored records, or grouping
  schema changed. The [grouping proposal](ASSET_GROUPING_PROPOSAL.md) is design only.

## Performance and verification

The reader JS is 36,583 bytes (12,787 gzip); WASM is 966,895 bytes (415,050 gzip).
These are first-scan downloads, not startup-blocking scripts. Hosting compression
and device caches determine actual network bytes. No extra OCR or AI request was
added. Barcode work runs alongside OCR; capture and upload can still take longer
for a larger, clearer photo. The budget includes decoder download, so a slow
first connection may time out and require retry even after OCR succeeds.

Automated checks use the real frontend and real local decoder, with synthetic
barcode images and a fake backend. Added coverage includes QR + Code128 in one
photo, leading zeros and exact glyphs, early results before delayed OCR, approval
and replacement cancellation, stale sessions, deadlines/cancellation, offline
WASM, actual still dimensions versus preview dimensions, native-camera fallback,
failed capture and delayed camera acquisition. Existing photo retries, detail
navigation, restricted guest uploads, local recognition and desktop creation
checks remain. Local synthetic scan timing is diagnostic, not phone performance
or proof of real-label accuracy.

Local verification on 2026-10-19: 30 Node unit/vendor checks and 22 browser
scenarios passed (23 browser TAP entries including their parent). Frontend and
Apps Script syntax checks and `git diff --check` passed. One synthetic cold
multi-code scan took about 121 ms under Chromium's 4× CPU slowdown, with the
main-thread heartbeat continuing; this excludes real mobile network/camera costs.
The previous private label was also retested through the new local browser
decoder and yielded only its warranty QR, with zero serial candidates. Private
images/results were kept outside the repository.

Run with Node 24:

```sh
npm ci
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
for file in public/*.js; do node --check "$file" || exit; done
node --check < apps-script/Code.gs
git diff --check
```

Omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if using Playwright's installed Chromium.
GitHub Actions runs the same suites. Vendor integrity tests compare committed
files with the pinned installed package and recorded SHA-256 hashes.

## Remaining issues and real-phone acceptance

- The previously inspected stored 480 × 640 label still yields a warranty QR,
  not a reliably decoded linear serial. Its printed digits were readable by
  focused OCR, but are not proof of the barcode payload. This patch cannot
  restore detail already lost. Retake the label, fill most of the frame, avoid
  reflection, hold steady and check every serial character before approval.
- Test physical Android Chrome and iPhone Safari, denied/revoked permissions,
  portrait/landscape, camera cancellation, flash, slow connection, backgrounding
  and large phone photos. Confirm sharpness, peak memory and total elapsed time
  on staff devices. Headless Chromium does not validate these camera behaviors.
- The five-second decoder budget is intentionally finite; tiny codes on a large
  label or damaged/glossy labels may still require closer capture/manual entry.
  Worker/OffscreenCanvas/WASM support varies; reader failure leaves OCR/manual
  fallback. Capture APIs do not guarantee a specific still resolution.
- Frontend serials remain strings, but the inspected backend returned a numeric
  serial cell. The owner should format identifier/serial columns as **plain
  text** in Sheets and ensure Apps Script writes/returns exact strings. Check
  new leading-zero and long-numeric serial round trips in a test spreadsheet.
  Formatting cannot restore zeros already lost; do not guess them or migrate
  existing records automatically. No live round-trip writes were performed.
- Provider accuracy/quotas and live persistence are unverified by mock tests.
  Existing iframe OCR/AI calls can each take up to 45 seconds; early barcode
  results do not eliminate that wait. Cancel/restart remains available.
- Existing backend write-idempotency and duplicate-race limitations remain as
  documented in [LOCAL_INPUT_AND_PHOTOS.md](LOCAL_INPUT_AND_PHOTOS.md).

## Isolated acceptance and release

1. Use a scratch copy outside the checkout. Copy `public/` and `firebase.json`;
   configure its `api-config.js` with an isolated Apps Script deployment backed
   by **copies** of Sheets/Drive. A Hosting preview alone does not isolate data.
   The owner manages Apps Script. Do not use real keys in source or test fixtures.
2. Serve locally or deploy a Hosting preview. Keep production unchanged during
   write testing. Test a real multi-code label, unreadable label, no-AI/no-OCR,
   different serials on identical equipment, an existing JCP tag, and cancelled
   replacement. Assert no write until the asset review form is submitted.
3. Save test serials starting with zeros and including `O/0/I/1`; reload from
   Sheets and verify exact equality. Check duplicates, per-unit photos, history
   and admin/staff/guest permissions. Delete only disposable test records.
4. Record physical device/browser versions, cold/warm and slow-network timings,
   image dimensions, outcomes and remaining failures. Check desktop live QR,
   manual creation, photo retries and existing asset update confirmation.
5. After review and explicit production approval, stage the approved commit,
   set the correct production Apps Script URL in the staged config, and deploy
   Hosting only. Verify `version.json`, decoder MIME/downloads, cached upgrade,
   barcode confirmation and API health. Keep the previous Hosting version for
   rollback. Never deploy the repository's intentionally blank API config.

No private asset records/photos or credentials are included in this patch.
