# Scanner and linked-asset navigation

The merged navigation fixes are released as frontend **2.8.1**, build `2.8.1-navigation-1`, based on merged main `76331e0`. The existing **2.8.0 Apps Script API** remains compatible; neither `.gs` file nor schema setup changes. Diagnostics send the explicit 2.8.0 API compatibility target while reporting the actual frontend release separately. The distinct version/build ID and service-worker cache advertise the update without changing pending queue scopes.

## Resulting behavior

| Action | Destination and retained information |
| --- | --- |
| Save a reviewed scan | Persist locally first, then show the register. Background metadata/photos continue. |
| Not now / dismiss the linked-asset prompt | Remain on the register; the saved asset stays queued. |
| Yes, add linked asset | Show the two capture choices without opening a camera. |
| Scan label with OCR | Close overlays, discard the previous completed/explicitly replaced evidence, clear any old update target, carry the selected main/placement, and start one camera. |
| Take asset photo | Open the native photo chooser in the user's tap. Cancelling retains the choices. Selecting a photo closes the old detail drawer and opens manual entry with that photo/main. |
| Close an unfinished scanner, then return | Resume the same processing/result stage, manual values, placement, conflicts and photos. Do not reopen the camera behind that review. |
| Scan to update from Edit or More actions | Start fresh evidence for only that selected record; do not inherit another asset's photos or linked-registration context. |
| Save a scan reconciliation | Return to the register while the reviewed operation syncs. |
| Navigate or replace a popup during a delayed save/read | Keep the new page/form; the older response cannot reopen a popup, close a new form or overwrite a different detail drawer. |

## Fixes

Camera startup is idempotent; user-controlled live-camera toggling remains explicit. Requests that finish after leaving the scanner release their streams. Overlays stop preview capture, and closing them resumes it only on a visible, idle mobile scanner. Scanner reset clears update targets, pending match timers and obsolete recognition jobs. Delayed desktop barcode initialization/detection cannot revive a departed capture.

Navigation, modal, drawer and scanner generations reject obsolete UI work while preserving valid background saves and scoped data caching. Detail actions bind immediately; slow images are guarded by the exact rendered drawer rather than binding an older asset's handlers to a newer linked record. Cached detail lookups, scan/stale-draft reviews and main-tag reads check their originating view before changing the DOM. Modal replacement retains the original focus destination without scrolling hidden screens; a new capture/result starts at the top.

The service-worker cache name changes for the static build. Durable saves, pending photographs, account scopes, backend configuration and application data are retained. The UI structure and capture choices remain unchanged.

## Validation

Run `node --test --test-isolation=none tests/*.test.js` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser`. Syntax checks cover all frontend JavaScript and Apps Script files; run `git diff --check` too.

Final validation passed **119 unit/backend/transport checks** and **80 browser scenarios (81 TAP tests including their parent)**, frontend/backend syntax checks and `git diff --check`.

Eleven new browser scenarios exercise the real frontend with a synthetic backend: scan-save confirmation and one fresh camera; unfinished review navigation during OCR; update-to-linked target isolation; native camera cancellation/photo-only entry; late scan review; late stale-draft review; late image delivery across linked details; late cached detail lookup; cancelled main-tag lookup; delayed scan-save acknowledgement; and delayed reconciliation acknowledgement. Existing offline/reload, duplicate/stale handling, scoped queue, mobile/desktop and legacy workflows remain covered.

Physical Android/iPhone camera permission/picker behavior and suspension still need device acceptance. Automated camera tests use canvas streams and native file-chooser events; no production asset is changed.
