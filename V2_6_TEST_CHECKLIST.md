# V2.6 Test Checklist (Preview Channel)

## Deployment and startup

- [ ] Apps Script `?action=ping` returns version 2.6.
- [ ] Existing `public/api-config.js` contains the current `/exec` URL.
- [ ] Sign in on Android/mobile, open Asset Details, and confirm no JS/connection error.
- [ ] Check System Setup > Diagnostics lists Groq key configuration accurately.

## Edit asset and performance

- [ ] In Edit Asset, tap the Category, Brand, and Area dropdown arrows; the native list opens on the phone.
- [ ] Confirm selecting a Site restricts the Area picker to that Site. Manual text entry still works.
- [ ] Change one field and tap Save; the button is disabled and visibly indicates saving.
- [ ] If the server exceeds eight seconds, a “still waiting” message appears; no duplicate submission.
- [ ] The saved value appears in the asset detail without a second blocking reload. Measure actual elapsed time.
- [ ] Test a moved asset: Site and Area are persisted correctly; movement history still records the change.

## Scan-to-update and matching

- [ ] In Asset Details > More actions > Scan to Update, take a photo and confirm it shows a comparison for that original record.
- [ ] In Edit Asset > Scan to update, repeat using Gallery instead of camera.
- [ ] The scanner shows stages and partial OCR fields before AI processing completes.
- [ ] A successful Groq interpretation shows a Groq badge, AI field mapping details, and OCR-versus-AI values.
- [ ] With no Groq key or an API error, scanner still displays OCR-only suggestions and a clear explanation.
- [ ] The HP Compaq 8200 Windows About photo is classified as Desktop PC with correct model and available specs, never as Monitor solely because it says “monitored”.
- [ ] Validate BlueTap brand is BlueTap, manufacturer not treated as brand, serial/IMEI separate.
- [ ] Brand-only matches from unrelated categories do not crowd the suggestions; genuine same-model records can still be reviewed.
- [ ] Tap Review Match on slow internet: the button shows Loading match, opens compare, and never silently merges.
- [ ] Confirm new scanned values are NOT saved until an authorized user submits reconciliation.

## Asset images

- [ ] Photo thumbnails fill their gallery cells without excessive empty gray space.
- [ ] Open an image, choose Set as main photo, then confirm the main image changes in Asset Details and the asset list.
- [ ] Repeat after reopening the PWA and changing account/device, to confirm backend persistence.
- [ ] Guests cannot select a main photo. Unrelated image IDs are rejected on the backend.

## Regression

- [ ] Desktop scanner layout unchanged; add asset, images, maintenance, audit and reports still work.
- [ ] No horizontal overflow at 360px, 390px, 430px or 768px.
- [ ] Existing external source codes/QR tags still resolve by exact asset ID/serial as before.
