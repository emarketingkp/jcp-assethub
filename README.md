# jcp-assethub
JCP AssetHub, a mobile-first asset management application built with Firebase Hosting, Google Apps Script, Google Sheets, Google Drive, OCR.Space and Groq AI.

## V2.7 source snapshot

This repository includes the source from `JCP_AssetHub_V2_7_PREVIEW.zip`. The owner reports that V2.7 is deployed. The supplied archive has not been compared against that deployment; its original release documents describe the earlier preview status.

Production Hosting was last updated on 2026-10-19 to build `2.7-still-barcodes-1` (confirmed by a read-only check on 2026-10-20). The grouping backend now advertises support; the corresponding frontend has not been deployed. This branch adds faster register searches and batch entry on top of the merged grouping work. See [performance measurements, entry changes and remaining limits](docs/PERFORMANCE_AND_FAST_ENTRY.md), [grouping implementation and the owner's Apps Script rollout](docs/GROUPS_AND_SETS.md), [scanner changes and validation limits](docs/STILL_CAPTURE_AND_BARCODES.md), and [earlier input/photo implementation notes](docs/LOCAL_INPUT_AND_PHOTOS.md).

- `public/`: Firebase Hosting frontend.
- `apps-script/`: Google Apps Script backend and manifest.
- `tests/`: Node.js unit/mock tests and Playwright browser regressions.
- `public/data/input-knowledge.json`: versioned public recognition dictionary.
- `START_HERE.md` and `V2_7_TEST_CHECKLIST.md`: original setup and acceptance references.
- `GITHUB_SETUP.md`: repository setup details and validation limits.

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
