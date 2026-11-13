# JCP AssetHub 2.10.0: handoff notes

**Source:** branch `ui/usability-overhaul`, commit `7ddcd80`, based on `main`.
**Status:** preview. Not pushed (the `afas2004` account has no write access to `emarketingkp/jcp-assethub`) and not deployed. This zip has no git history.

## What changed
- **Readability:** larger text, normal font weights, one main-button colour, and read-only details that no longer look like buttons.
- **Asset list:** plain rows. Peripherals show as a one-line list under their main asset, and identical models are a small note.
- **Asset details:** one action bar, fixed at the bottom on phones. The ⋯ menu holds Update from scan, Print QR label, Merge duplicate, Separate again, Restore and Retire.
- **Drafts and unsent saves:** an "On this device" screen where they can be retried, edited or discarded.
- **Maintenance:** read-only ticket view, status and detail forms, archive and restore.
- **Audit:** results view, CSV export, rename, cancel, and change or reset a result.
- **System Setup:** archived items stay listed and can be restored; users can be disabled and enabled.
- **Scan and edit forms:** editable technical attributes, a Scanned text sheet, and suggestions while typing instead of dropdowns.
- **Popups and navigation:** timed popups at the bottom of the screen; Cancel, close and Back return to where a task started.
- **Speed:** startup cache split into chunks, logs read only recent rows, and audit verify and maintenance saves update the screen first.
- **Security fixes:**
  - Staff can no longer retire assets through the old edit route.
  - The public image route serves registered photos only.
  - Guests can't read activity reports or repair costs.
  - Renaming a user can't create a duplicate account, and the last Admin can't be removed.
  - The hard-coded default admin password is removed.

## Deploy steps
1. Test on a copy of the data first.
2. Deploy the frontend (`public/`) to Firebase Hosting.
3. Replace both `Code.gs` and `AssetGroups.gs` in Apps Script, then deploy a new version.
4. Run `setupAssetGrouping()` once. It adds the new maintenance column.
5. New database only: set Script Properties `INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD` (at least 8 characters), then run `setupDatabase()`.
6. Check System Setup → System shows backend 2.10.0.

## Testing status
- Unit tests: 152 pass, 1 fails. `tests/barcode-vendor.test.js` needs `npm install`; it was already failing before this work. Each new backend action has its own unit test.
- Browser (Playwright) tests: updated but **not run**. Some may need fixing, including the steps for grouped rows.
- Only the More sheet fix was confirmed in a browser. The redirect changes and the latest screens have not been checked on a real phone.
- Live speed is unmeasured. Each reply now reports server time, shown under System Setup → System.
- The real Apps Script backend, OCR, sync and permissions have not been tested with these changes.

## Known gaps
- The old asset form and set flow are still in the code. Remove them after the 2.10.0 backend is live and the browser tests pass.
- The "Separate again" (unmerge) option only works for merges made after this update.
- Not done:
  - live global search
  - names instead of IDs in printed reports
  - clickable report rows
  - per-photo type editing
  - lighter write replies
  - separate caching for sites, areas and categories
- Asset details show only history from the newest 2,000 log rows.
