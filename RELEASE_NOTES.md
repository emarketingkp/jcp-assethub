# 2.8.1 — navigation fixes deployed

Build `2.8.1-navigation-1` corrects scanner/camera entry, preserves unfinished reviews, returns saved scans to the register and ignores obsolete screen responses. See [navigation fixes](docs/NAVIGATION_FIXES.md). This frontend build remains compatible with the 2.8.0 backend and needs no Apps Script changes.

Deployed to Firebase Hosting on 2026-10-22. Hosting version `a5b76011d6786eca`; previous version `0d45238bcbd3bb33` is retained for rollback. All 30 public files match the tested release, and `api-config.js` was preserved exactly. Validation: 119 unit/backend checks and 82 browser TAP tests passed. No Apps Script deployment was performed.

The base `2.8.0-simple-links-1` frontend was deployed on 2026-10-22. It implements the later approved simple asset-link workflow and background-save behavior. See [SIMPLE_ASSET_LINKS.md](docs/SIMPLE_ASSET_LINKS.md) for the complete scope, additive backend setup, validation and rollout boundaries. The notes below are historical.

# Release Notes — JCP AssetHub V2.7 Preview

Date: 19 October 2026. Baseline: V2.6 (16 October 2026). **Status: code preview; not deployed.**

## New

1. `interpretOcrUniversal`: server-side Groq Responses API strict JSON schema for core fields, manufacturer/secondary model, typed identifiers and arbitrary technical attributes. OCR evidence validation and cautious serial labeling checks. API keys remain in Apps Script Script Properties.
2. `suggestMatchesV27`: reuses existing fuzzy matching, adds JCP Asset ID and cautiously typed comparisons from existing labeled Specifications; part number alone never becomes an automatic duplicate.
3. `recognition-v27.js`: pure, testable OCR normalization, AI evidence checking, multi-source consolidation, conflicting-value review and Specifications generation.
4. Recognition result now shows real scan stages, partial OCR results, a six-image source gallery, source-level evidence, raw OCR, editable fields and visible conflict resolution.
5. Reconciliation now shows actual changed/new fields, requires selected incoming changes, and offers non-destructive Specifications combination. Existing values remain if not explicitly approved.
6. Multiple scan photographs are carried through Create or Reconcile for standard Drive upload.
7. Dedicated frontend/browser simulation and mocked backend/pure consolidation regression tests.

## Preserved

V2.6 Firebase front-end architecture, Apps Script/Sheets/Drive backend, guest/staff/admin permission design, desktop barcode scanner, asset management, audit, movement, maintenance, reports, and image gallery actions.

## Not implemented in this preview

Permanent database indexing for all recognized identifier types; searchable long-term OCR/provenance history; new CustomFields generated from AI; production deployment or live provider integration tests.

## Rollback

Restore previous Apps Script Web App version first (matching existing endpoint), restore previous Firebase Hosting release, and reload the PWA to clear the V2.7 cache. The package uses no new Sheet schema, so no schema rollback is needed.
