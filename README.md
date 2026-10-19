# jcp-assethub
JCP AssetHub, a mobile-first asset management application built with Firebase Hosting, Google Apps Script, Google Sheets, Google Drive, OCR.Space and Groq AI.

## V2.7 source snapshot

This repository includes the source from `JCP_AssetHub_V2_7_PREVIEW.zip`. The owner reports that V2.7 is deployed. The supplied archive has not been compared against that deployment; its original release documents describe the earlier preview status.

The latest changes add local input assistance and clearer camera/gallery controls. These changes have not been deployed. See [implementation and isolated testing notes](docs/LOCAL_INPUT_AND_PHOTOS.md).

- `public/`: Firebase Hosting frontend.
- `apps-script/`: Google Apps Script backend and manifest.
- `tests/`: Node.js unit/mock tests and Playwright browser regressions.
- `public/data/input-knowledge.json`: versioned public recognition dictionary.
- `START_HERE.md` and `V2_7_TEST_CHECKLIST.md`: original setup and acceptance references.
- `GITHUB_SETUP.md`: repository setup details and validation limits.

## Local checks

Use Node.js 24. Unit/mock tests have no external dependencies. Install the pinned development dependencies to run browser tests.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
for file in public/*.js; do node --check "$file" || exit; done
node --check < apps-script/Code.gs
```

GitHub Actions runs these checks on pushes and pull requests. Browser tests use the real frontend with a synthetic backend and image fixtures. They do not verify the live deployment, physical phone cameras, real AI responses, or Sheets/Drive writes.

## Configuration and deployment

The archived `public/api-config.js` intentionally contains a blank backend URL. The live site's configuration may differ. Keep OCR.Space and Groq credentials in Apps Script Script Properties; never put them in frontend files, Git commits, or GitHub workflow files. Firebase project mappings and local Apps Script configuration are ignored by Git.

There is no deployment workflow in this repository. Production deployment requires the owner's explicit approval. Do not run the original archive's deployment instructions as part of repository setup or automated checks.
