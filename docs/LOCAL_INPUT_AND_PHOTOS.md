# Local input assistance and photo flows

Frontend build: `2.7-input-photos-1`. Backend compatibility version remains `2.7`, because the existing Apps Script diagnostics require an exact frontend/backend API version match. The development-check package version is `2.7.1`. This change has not been deployed or verified against production.

## Behavior changes

- Added `public/data/input-knowledge.json` and `public/input-assist.js`: a small, versioned directory of equipment brands, aliases, category phrases, English/Malay field labels, and specification labels. It is served from Firebase alongside the application, not fetched from GitHub during scans.
- Knowledge loads once in the background, uses the existing IndexedDB store for a last validated copy, and survives offline reload through the service worker. Refresh requests have a two-second timeout. Invalid, oversized, ambiguous brand/field/specification aliases, and unsupported-schema updates cannot replace the validated dictionary. No remotely supplied code or regular expressions execute.
- Expanded brand choices beyond previously saved asset brands. Exact brand aliases can produce standard-name suggestions; near spellings produce confirmation buttons without rewriting input. Explicit unknown brand labels remain usable. HP and HPE remain distinct. Component/compatibility text does not automatically supply the equipment brand.
- Category phrases are ranked by specificity against active backend reference categories. Generic Windows/RAM/LCD text no longer implies Desktop PC or Monitor when local knowledge is available. Ties remain unselected. Unknown labeled categories require confirmation rather than creating a master category during recognition.
- Generic labeled model and serial extraction complements the existing parser. Manufacturer stays separate from brand. Serial characters are never fuzzy-corrected. Specification aliases such as Memory/RAM share a key so conflicting values are exposed.
- Model suggestions use known records for the selected brand, plus optional curated model entries. The public model list starts empty rather than introducing unverified models. There are no copied asset records, people, sites, serial numbers, or credentials in the public knowledge file. Site/area, assignee, location, and custom-field references retain their existing backend source and access rules.
- Local classification appears before AI. Evidence-validated disagreements between local and AI fields become explicit conflicts. AI-only inferred categories are suggestions requiring confirmation. Input events preserve manual edits and cursor focus when late recognition/matching responses redraw the results. Matching requests from typing are debounced by 400 ms.
- Added `public/photo-picker.js` and shared styling: explicit Take photo and Choose from gallery controls, accumulated selections, image previews, removal, duplicate-selection suppression, and object-URL cleanup. Camera input has `capture="environment"`; gallery input does not. Browser/OS support determines whether the camera opens directly.
- The post-scan asset form shows photos without opening another collapsed section. Original scans retain `serial_label` type; additional photos use `other`. Adding form photos attaches evidence without rerunning OCR or changing reviewed fields. Up to 12 photos may be attached in one form; recognition sessions retain their existing six-photo limit.
- Asset details expose camera and gallery actions. The upload dialog supports multiple selections and defaults to Additional Photo so adding an image does not silently replace an existing main photo. Explicit image-type choices remain available. Admin image replacement uses the same camera/gallery controls with one replacement selection and retains the existing image type.
- After successful scanned creation, the scanner session is cleared, the Assets view is selected, and the saved asset detail drawer opens. Existing-asset edits still open details. Manual creation keeps the previous QR-label workflow, and QR labels remain available from asset details.
- Successful record creation/update is retained within the form while photos upload. A known photo failure offers Retry photo upload and View saved asset; retry does not create another record or repeat confirmed successful uploads. Saved fields are frozen during photo retry. The modal cannot be dismissed through its controls, backdrop, or Escape during an active upload. Guest creation retains the existing scoped upload grant; detail uploads and replacement retain Staff/Admin access checks.
- Updated script loading, service-worker cache, and build metadata. Added a locked development-only Playwright dependency, regression scripts, GitHub Actions checks, README updates, and this change record. Apps Script code, schema, permissions, backend routes, and original tests are unchanged.

## Automated validation

Validated locally on 2026-10-19 with Node.js 24.19.0 and system Chromium 154.0.8037.57: all 26 unit/mock checks passed, and all 11 browser scenarios passed (the browser runner reports 12 passing tests including its parent test). No checks were skipped. Frontend/Apps Script syntax checks and JSON parsing passed. The final local classification measurement was p50 2.4 ms, p95 4.3 ms, maximum 9.0 ms under 4x CPU slowdown. The knowledge file is 7,938 bytes uncompressed and 1,449 bytes with gzip. These are local results, not a GitHub Actions run or real-device acceptance.

From the repository root with Node.js 24:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
for file in public/*.js; do node --check "$file" || exit; done
node --check < apps-script/Code.gs
```

For a machine with system Chromium, browser tests can instead use:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

Unit/mock coverage includes the two original scripts and new scenarios for brands/aliases, components, ambiguity, unknown brands, Malay labels, unchanged serials, model scoping, category specificity/active categories, specification conflicts, AI disagreement, manual overrides, and offline/corrupt dictionary refresh.

Browser regressions run the actual frontend against an explicitly synthetic backend on an ephemeral loopback server. All HTTPS requests are blocked. Tests cover mobile photo accumulation/removal, capture/gallery input attributes and file choosers, scanned save-to-details, complete/partial photo retry, existing-asset edits, Admin replacement, delayed/unavailable AI, Guest upload grants, desktop manual-create/QR behavior, offline service-worker reload, horizontal layout, and local classification performance. Screenshots are generated under ignored `test-results/`.

The local classification budget test uses a 32-line synthetic label, 100 measured iterations after warmup, and Chromium's 4x CPU slowdown; p95 must stay below 50 ms. This measures local text classification only, not image reading, OCR/AI latency, phone hardware, or end-to-end scanning. Current execution results should accompany the PR; GitHub Actions results are separate from local results.

## Isolated acceptance procedure

1. Use a separate Firebase **test project**, a separate Apps Script project/deployment, a copied test spreadsheet, and a test-only Drive folder. A Firebase preview channel pointing to production Apps Script is not isolated: saves would still write to production.
2. Put only test accounts and synthetic assets in those copies. Configure the copied Apps Script properties and existing permissions for the test resources. Enter provider credentials through Script Properties, never Git or chat. This frontend change does not require a new backend API, but its integration still needs verification.
3. Serve a disposable copy of `public/` and `firebase.json` outside the checkout with that test project's explicit Firebase mapping. Set the disposable copy's `api-config.js` to the **test** Apps Script `/exec` URL. The tracked URL remains intentionally blank. Preserve the deployed site's actual configuration independently; do not overwrite it from this archive.
4. After the test projects are configured, deploy only the disposable copy to a preview channel in the explicit test project, for example `firebase hosting:channel:deploy input-photos-review --project YOUR_TEST_PROJECT_ID`. This procedure is documented only; no deployment was executed here.
5. On an actual staff Android phone and iPhone, test camera permission granted/denied, camera cancellation, gallery cancellation, repeated selections, image removal, unsupported image formats, large photos, and portrait/landscape orientation. Confirm labels remain readable after compression.
6. Scan representative, consented labels: listed/unlisted brands, several brands on one image, component/vendor names, English/Malay labels, ambiguous Windows screens, several printer types, and multiple conflicting photos. Compare every proposed value with the label. Exercise normal AI, unavailable Groq, OCR failure, slow networking, and a later offline reload. Dictionary/manual entry must remain usable; network-dependent saves should not be expected offline.
7. Create a synthetic scanned asset with added camera/gallery photos. Verify the detail drawer opens and the exact record, serial, image types, test Sheet row, and test Drive files agree. Interrupt one photo upload and retry; verify no second asset or repeat of confirmed successful photos. Test Staff edits, Guest creation/grant expiry, and Admin image replacement without weakening access rules.
8. Check desktop manual entry, existing edits, QR labels, maintenance, audits, reports, and custom fields using the existing V2.6/V2.7 checklists. Those broader live workflows have not been revalidated by this frontend patch's focused tests.
9. Record device/browser, backend version, dictionary/build version, label truth, errors, and timings. Obtain owner acceptance before preparing a production rollout. Production deployment needs explicit approval, a verified live configuration, and saved Firebase rollback release and Apps Script/data backups.

## Unresolved issues and limits

- No live OCR.Space/Groq requests, production comparisons, physical phone captures, test Sheet/Drive writes, or real role-enforcement acceptance checks have run. Browser fixture tests are not proof of those capabilities.
- The dictionary cannot read a logo or recover text OCR never returns. OCR.Space failure still needs manual input or available barcode/QR recognition. No heavy on-device OCR model is introduced.
- The dictionary is curated initial coverage, not a universal manufacturer/model catalogue. New aliases and model entries need evidence and review. Multiple brands, category ties, and local/AI conflicts can require extra staff input; confidence scores are not accuracy probabilities.
- Legacy backend brand/category heuristics remain unchanged for older clients or when no validated local dictionary is available. This client displays a warning if the dictionary cannot load. Provider/matching request latency outside local classification retains the existing transport timeouts.
- Retry protection covers the known saved record in the currently open form and confirmed completed photo responses. It is not backend idempotency. If a create/upload response is lost after the server commits, the client cannot establish whether it succeeded. Closing/reloading also loses the pending File objects. Check the saved record before retrying ambiguous timeouts; a future backend idempotency design is still needed.
- Browser checks preserve the existing Guest/Staff/Admin UI boundaries and guest upload grant plumbing; they do not audit backend authorization. Broader repository security/AI accuracy review remains outstanding.
- This branch is for review. No merge or production deployment is authorized by these implementation notes.
