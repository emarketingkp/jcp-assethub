# Read Before Updating to V2.6

**This version is not deployed by ChatGPT.** Back up V2.5 before making changes.

The package modifies BOTH `apps-script/Code.gs` and Firebase `public/`. Deploy the new Apps Script code first. The existing endpoint address remains unchanged if you update the current Web App deployment; put that same address in `public/api-config.js` before deploying Firebase.

## Identifier comparison: what is and isn't a match

- **Confirmed exact match:** a valid JCP AssetHub asset ID/QR tag or the exact normalized registered serial in the Assets sheet.
- **Possible match:** similarity across brand, commercial model, category/type, specifications and (when supplied) site/area. Brand alone is not sufficient for a credible suggestion; Windows Device ID and Product ID are NOT treated as a device serial.
- **Not supported as guaranteed exact identifiers:** arbitrary manufacturer's QR support URLs, every IMEI/MAC value embedded in unstructured specifications, or every photo in AssetImages. These may provide additional review information but should not cause automatic merges.
- **No automatic merge:** any candidate must be chosen by a Staff/Admin user; field conflicts default to the existing value unless the user explicitly changes the radio selection.

## Groq AI

Configure `GROQ_API_KEY` in Apps Script Script Properties. `GROQ_MODEL=openai/gpt-oss-20b` is the default, not a requirement to create a new paid account. The application uses OCR.Space first and only sends OCR text plus parser hints to Groq for field assignment. If AI fails, ordinary OCR remains usable. Verify in scan results that the green Groq badge is displayed; a configured key alone does not prove a successful request.

## Performance

Saving to Sheets remains a network-bound operation. V2.6 shows a continued-waiting indicator after eight seconds, disables repeated submit, and delays a secondary background sync. If writes still take a long time in production, capture a timestamp, browser/network timing and Apps Script execution log; this is required before tuning backend calls further.
