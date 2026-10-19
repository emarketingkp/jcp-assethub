# V2.7 acceptance checklist (manual live preview)

**Do not deploy to production until all release-blocking tests pass.**

- [ ] Exact version is `2.7` at `?action=ping`, UI version and `version.json`; service worker cache contains `v2.7`.
- [ ] Real iOS Safari / Android Chrome camera captures and gallery upload return and show photo thumbnails. Live desktop QR scan still works.
- [ ] 1st photo OCR yields visible partial fields **before** optional Groq finishes. No fake percentage progress.
- [ ] Add photo 2: complementary PC label + Windows About RAM/CPU/storage combine to **one** record; image sources appear.
- [ ] Conflicting serial/CPU/RAM values block Create/Review until each conflict is selected; removing a photo recomputes fields.
- [ ] Unfamiliar equipment label produces useful fields without changing any brand-specific parsing code.
- [ ] No IMEI, MAC, Windows Device ID/Product ID or vendor QR support link is promoted into serial.
- [ ] Labeled technical attributes retain numbers and units; hardware identifiers retain their identifier types.
- [ ] Exact JCP asset QR and registered serial take priority, brand-only suggestions never appear as a credible match.
- [ ] Matching IMEI/MAC is compared only against **same-type labeled identifiers**; part/SKU alone is not an exact device match.
- [ ] Scan-to-update from Asset Detail offers only changed/new fields; unapproved fields are not written.
- [ ] Existing Specifications are preserved when combining with newly detected non-conflicting keys, and manually selected replacements work.
- [ ] Create flow requires user-selected Site/Area, does not infer status/assignment, and uploaded photos appear in Drive and asset detail.
- [ ] Guest can manually create with OCR fallback. Staff/Admin Groq and operational update paths work; Guest cannot modify existing assets.
- [ ] Groq API key missing, invalid, 429, timeout and invalid output: raw OCR/manual mode remains usable.
- [ ] OCR API failure or unreadable photo: user can add a new photo or manually fill required fields.
- [ ] After creating/updating, asset changes appear, no duplicate caused by double click, and activity history is intact.
- [ ] Existing maintenance, movements, audit, reports, custom fields, images and restricted AssetPrivate data work unchanged.
- [ ] Verify on real devices with at least desktop PC, laptop, monitor, inkjet, laser, dot matrix printer, phone, router, terminal, production equipment and an unfamiliar label.
- [ ] Real provider quotas/timing and Google Apps Script execution logs reviewed. Rollback version available.

Automated mock tests run with `node tests/recognition.test.js` and `node tests/backend-mock.test.js`. These cannot substitute for live external-service testing.
