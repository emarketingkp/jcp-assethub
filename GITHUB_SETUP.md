# GitHub repository setup

## Imported snapshot

Source: owner-supplied `JCP_AssetHub_V2_7_PREVIEW.zip`.

All 34 files from the archive are retained at the repository root with their original relative paths and contents. Application code, tests, Firebase configuration, Apps Script permissions, screenshots, and the archive's original documentation are unchanged.

This snapshot is not a backup of live Google Sheets, Drive files, Apps Script properties, or deployed Firebase settings. The owner reports V2.7 is deployed; the archive's historical preview status does not establish the current deployment state.

## Repository additions

- Expanded the existing README with source layout, local checks, configuration boundaries, and deployment status context.
- Added `.gitignore` for common credentials, local Firebase/Apps Script configuration, dependencies, logs, ZIP archives, and backup directories. This is preventive and does not replace reviewing commits for secrets.
- Added `.github/workflows/checks.yml` with read-only repository permissions, Node.js 24, both existing mock suites, and JavaScript/Apps Script syntax checks. The workflow does not deploy or contact application services.
- Added this setup record.

## Validation and limits

Both included mock test scripts and syntax checks passed locally on Node.js 24. JSON configuration files parsed successfully. Imported files were compared byte for byte against the archive. The text-file credential scan found no API keys; fixture and browser-storage identifiers were inspected as false positives. This is not a complete security audit.

No live deployment, asset records, API keys, user permissions, or cloud configuration were changed. No application bug fixes or new regression tests were introduced during repository setup. Real mobile scanning, provider accuracy, backend compatibility, and safe asset updates remain outside this GitHub-only task.

The setup is delivered on a separate branch for review. A successful local check does not establish that GitHub Actions has run or that the production application works. Do not merge or deploy automatically.
