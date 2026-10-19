# JCP AssetHub V2.7 — PREVIEW RELEASE

**Built on V2.6. Not deployed.** V2.7 introduces a universal AI/OCR asset recognition workflow. Keep a copy of your V2.6 source, your live Apps Script deployment version, and a Google Sheets/Drive backup for rollback.

## What you get

- Universal, schema-constrained Groq interpretation of OCR.Space label/screen text; manufacturer-specific parsing rules are not required for the AI path.
- Evidence-validated standard fields, typed identifiers, flexible technical attributes, and OCR fallback when Groq is unavailable.
- Up to six photos per recognition session with editable core fields, source references, source-value conflicts, and raw OCR disclosure.
- Real capture/OCR/AI/matching stage status, partial results before AI finishes, and safe session cancellation.
- More careful possible-match ranking (JCP Asset ID, serial/service tag, typed IMEI/MAC where stored as labeled specifications; model/category/specs as weaker hints).
- Explicit reconciliation with **keep, replace, or non-destructively combine** existing technical specifications; unapproved/unchanged fields are not overwritten.
- Existing V2.6 desktop live scanning, assets, maintenance, audits, reports, permissions and Firebase PWA structure retained.

## Deployment sequence — preview first

1. Back up your **currently working** Firebase folder and Apps Script code, and take an independent backup of the live Google Sheet and Drive folder.
2. Confirm Apps Script Script Properties: `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `OCR_API_KEY`, `GROQ_API_KEY` (optional) and `GROQ_MODEL` (optional, default `openai/gpt-oss-20b`). Do **not** copy API keys into any Firebase file.
3. Copy `apps-script/Code.gs` to the **existing** Apps Script project. Use Manage deployments → Edit the existing Web App deployment → New version. Test `<your existing /exec URL>?action=ping` and confirm version `2.7`.
4. Copy the configured production `API_URL` from your **own previous** `public/api-config.js` to this package's intentionally blank `public/api-config.js`. Do not paste a token or API secret there.
5. Copy the complete `public/` folder plus `firebase.json` into a disposable Firebase preview working directory. Keep your own `.firebaserc` project mapping.
6. Deploy to a Firebase **preview channel** first: `firebase hosting:channel:deploy preview`.
7. On your real phone and desktop, test the workflow using the checklist, checking live OCR.Space, Groq, permissions, save/record reconciliation, all photos and Google Sheets/Drive writes.
8. Only if accepted: deploy frontend using your normal `firebase deploy --only hosting` process. Preserve the previous Hosting release and Apps Script version for rollback.

**Deploy backend before frontend**: new UI actions `interpretOcrUniversal` and `suggestMatchesV27` are not present in V2.6.

## Local automated test commands

```sh
node tests/recognition.test.js
node tests/backend-mock.test.js
node --check public/app.js
```

The tests are mocked: they do **not** call the real Google Spreadsheet, Drive, Groq, OCR.Space, camera or Firebase deployment. A mobile Chromium mock UI pass was also completed while building the package.

## Important limits / outstanding live verification

- **Production acceptance is not claimed.** Live phone camera, OCR.Space/Groq latency and quotas, role enforcement against your actual users, source-photo uploads, and Google Sheet writes still need your preview deployment.
- Typed non-serial identifiers are stored as **labeled Specifications text** under the existing schema; a full structured identifier index is not built. Only explicitly labeled same-type values can be used for matching, and possible matches never update automatically.
- Photos are uploaded as asset evidence on Save; raw OCR and the complete field-provenance mapping remain **in the current recognition session** rather than being permanently stored in a new sheet. This avoids retaining unnecessary sensitive screen text, but if permanent searchable OCR history is required, that needs a separate agreed storage/access design.
- Detected technical attributes are placed into the existing Specifications field. V2.7 does **not** auto-create master CustomFields; existing custom field behavior is preserved.
- Groq is optional and available to logged-in Staff/Admin scanning sessions; Guest onboarding retains OCR fallback. AI rate limits or failures must not block manual entry.
- No new database sheets/columns or destructive migration are introduced.

See `V2_7_TEST_CHECKLIST.md` and `RELEASE_NOTES.md`.
