# jcp-assethub

## 2.9.0 — complete asset workflows deployed

Hosting build `2.9.0-unified-assets-2` was deployed and all 35 public files verified on 2026-10-23. Existing fields and records are retained. Both Apps Script files and additive `setupAssetGrouping()` are required to enable the new editor; Apps Script deployment remains owner-managed and was not performed or verified here. See [workflow, preservation and owner setup](docs/UNIFIED_ASSET_WORKFLOWS.md).

JCP AssetHub, a mobile-first asset management application built with Firebase Hosting, Google Apps Script, Google Sheets, Google Drive, OCR.Space and Groq AI.

## 2.8.1 — navigation fixes deployed

Build `2.8.0-simple-links-1` was deployed to Firebase Hosting on 2026-10-22. The merged navigation fixes were deployed as `2.8.1-navigation-1` on 2026-10-22. All 30 Hosting files were verified, and the live backend configuration was preserved. See [navigation fixes and validation](docs/NAVIGATION_FIXES.md); it works with the existing 2.8.0 Apps Script backend.

The approved workflow now saves directly from scan results, uses one optional main-asset reference, and offers OCR or photo-only manual entry for linked assets. Metadata changes and photo uploads run through a scoped durable queue. See [workflow, additive backend setup and validation](docs/SIMPLE_ASSET_LINKS.md). Update **both** `Code.gs` and `AssetGroups.gs`; the owner controls Apps Script deployment. The navigation fix requires no additional backend setup.

## V2.7 source snapshot

This repository includes the source from `JCP_AssetHub_V2_7_PREVIEW.zip`. The owner reports that V2.7 is deployed. The supplied archive has not been compared against that deployment; its original release documents describe the earlier preview status.

Production Hosting was updated on 2026-10-20 to build `2.7-fast-entry-1`, including grouping and faster entry. This branch adds progressive connection checks and explicit OCR/Groq tests; it has not been deployed and needs an updated `Code.gs`. See [connection checks, findings and rollout](docs/CONNECTION_HEALTH.md), [performance and entry improvements](docs/PERFORMANCE_AND_FAST_ENTRY.md), [grouping and backend setup](docs/GROUPS_AND_SETS.md), [scanner notes](docs/STILL_CAPTURE_AND_BARCODES.md), and [earlier input/photo changes](docs/LOCAL_INPUT_AND_PHOTOS.md).

- `public/`: Firebase Hosting frontend.
- `apps-script/`: Google Apps Script backend and manifest.
- `tests/`: Node.js unit/mock tests and Playwright browser regressions.
- `public/data/input-knowledge.json`: versioned public recognition dictionary.
- `START_HERE.md` and `V2_7_TEST_CHECKLIST.md`: original setup and acceptance references.
- `GITHUB_SETUP.md`: repository setup details and validation limits.

The sequential linked-asset workflow and durable-save changes are documented in [workflow, backend update steps and validation limits](docs/SEQUENTIAL_SET_WORKFLOW.md). Frontend version `2.7.2` was deployed to Firebase Hosting on 2026-10-21 with the existing backend configuration preserved. The Apps Script changes still require the owner's update and schema setup.

## Local checks

Use Node.js 24 and install the pinned development dependencies for the unit, vendor-integrity and browser checks.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
for file in public/*.js; do node --check "$file" || exit; done
for file in apps-script/*.gs; do node --check < "$file" || exit; done
```

GitHub Actions runs these checks on pushes and pull requests. Browser tests use the real frontend with a synthetic backend and image fixtures. They do not verify the live deployment, physical phone cameras, real AI responses, or Sheets/Drive writes.

## Configuration and deployment

The archived `public/api-config.js` intentionally contains a blank backend URL. The live site's configuration may differ. Keep OCR.Space and Groq credentials in Apps Script Script Properties; never put them in frontend files, Git commits, or GitHub workflow files. Firebase project mappings and local Apps Script configuration are ignored by Git.

There is no deployment workflow in this repository. Production deployment requires the owner's explicit approval. Do not run the original archive's deployment instructions as part of repository setup or automated checks.
