# JCP AssetHub V2.7
## Universal AI Asset Recognition Engine — Technical & Functional Specification

**Status:** Proposed — awaiting approval  
**Technical baseline:** JCP AssetHub V2.6  
**Priority:** High  
**AI provider:** Groq Free Tier  
**OCR provider:** OCR.Space  
**Platforms:** Mobile-first web application and desktop  
**Backend:** Google Apps Script, Google Sheets and Google Drive

---

## 1. Project Objective

Develop a universal asset-recognition system capable of extracting, interpreting, organizing and reconciling equipment information from many types of photographed labels, screenshots and documents.

The detector must not depend on maintaining individual parsing rules for HP, Epson, Canon, BlueTap or other specific manufacturers.

**Primary goal:** Scan unfamiliar equipment information, identify meaningful fields, progressively populate an asset record and allow the user to verify results before saving.

### Key principles

1. Understand field meaning rather than rely on fixed label formats.
2. Extract as much useful information as the source supports.
3. Do not fabricate unknown identifiers or specifications.
4. Preserve original evidence alongside interpreted information.
5. Allow multiple photographs to contribute to one asset.
6. Prioritize existing-asset reconciliation over duplicate creation.
7. Never automatically overwrite, move or merge existing assets.
8. Remain functional when Groq is unavailable.
9. Preserve working V2.6 features and desktop behaviour.
10. Keep recurring AI processing within free-tier allowances wherever feasible.

---

## 2. Recognition Input Support

The recognition system must support:

| Input type | Typical information |
|---|---|
| Product identification label | Brand, model, serial, category |
| Manufacturer sticker | Manufacturer, part number, electrical rating |
| Computer specifications screen | CPU, RAM, graphics, storage, OS |
| Phone information screen | Model, IMEI, operating system |
| Network equipment label | MAC, model, hardware version |
| Printer label | Model, serial, voltage, regulatory identifiers |
| Production machinery plate | Model, capacity, electrical and mechanical ratings |
| JCP asset QR label | Internal Asset ID |
| Mixed or unfamiliar labels | Any recognizable relevant attributes |

Different layouts, field ordering, abbreviations and combinations must be supported.

### Multiple-image session

A user may take several photographs of the same asset.

Example:

- Image 1: product label → brand, model, serial.
- Image 2: system information → processor, RAM, storage.
- Image 3: back label → power rating, manufacturer.

The system combines observations into **one proposed asset record** while retaining which image supplied each value.

---

## 3. Recognition Architecture

### Stage 1 — Capture

- Launch full-screen camera on mobile.
- Allow gallery upload.
- Support Add Another Photo within a recognition session.
- Show captured-photo thumbnails.
- Allow removal and replacement before confirmation.
- Preserve adequate image quality for OCR.

### Stage 2 — OCR Extraction

OCR.Space extracts raw text.

Requirements:

- Retain original line breaks and text.
- Retain source image references.
- Preserve label/value relationships where the OCR output supports them.
- Detect JCP asset codes and QR/barcode identifiers separately.
- Store raw OCR independently of AI interpretation.

### Stage 3 — General AI Interpretation

Send relevant OCR text to Groq with a universal, schema-based extraction instruction.

Groq must:

- Identify equipment category.
- Distinguish brand from manufacturer.
- Recognize commercial models and secondary model codes.
- Identify explicitly labelled identifiers.
- Interpret technical specifications.
- Return structured standard fields and additional attributes.
- Preserve evidence for extracted values.
- Mark uncertain or conflicting interpretations.

No new brand-specific parser should be required for ordinary label differences.

### Stage 4 — Deterministic Validation

AssetHub verifies the proposed AI fields.

Examples:

- Serial values must have source evidence.
- IMEI and MAC must not automatically become serial numbers.
- Commercial product model takes precedence over an unlabelled internal code when supported by the source.
- Numerical specifications must retain appropriate units.
- Unknown values remain blank.
- Conflicting values must be flagged for review.

### Stage 5 — Asset Matching

Search existing records using identifier and equipment evidence.

### Stage 6 — User Confirmation

Display proposed values, source evidence, conflicts and matching candidates.

Only confirmed changes may be committed.

---

## 4. Universal Field Structure

### A. Standard asset fields

| Field | Extraction behaviour |
|---|---|
| Category | AI-suggested equipment type |
| Brand | Customer-facing product brand |
| Manufacturer | Legal equipment manufacturer, if identified |
| Model | Commercial product model |
| Secondary model | Engineering or internal model designation |
| Serial number | Explicit equipment serial |
| Asset ID | JCP-managed asset identifier |
| Site | Existing record or manual selection |
| Area / Department | Existing record or manual selection |
| Status | Existing record or manual selection |
| Assigned To | Existing record or manual selection |

**Important:** Site, area, assignment and operational status must never be guessed from a product label.

### B. Additional identifiers

Supported identifier types include:

- IMEI / IMEI 2
- MAC address
- Service Tag
- Part Number / SKU
- Regulatory ID
- Hardware Version
- Firmware Version
- Device Name / Hostname
- Additional labelled identifiers

Every identifier must retain its type. A MAC address cannot be compared as though it were a serial number.

### C. Dynamic technical attributes

The system must support arbitrary key/value pairs instead of restricting specifications to predefined categories.

Examples:

| Equipment | Dynamic attributes |
|---|---|
| Desktop PC | CPU, RAM, RAM type, graphics, HDD, SSD, OS |
| Printer | Print technology, resolution, connectivity |
| Monitor | Screen size, resolution, refresh rate |
| Router | Wi-Fi standard, LAN ports, firmware |
| Terminal | Hardware version, input voltage, current |
| Machinery | Motor power, operating capacity, phase, voltage |

Unknown attributes must not be discarded merely because they lack a predefined database column.

### D. Data persistence

- Store recognized core values in existing `Assets` fields.
- Use existing `CustomFields` / `CustomValues` for approved structured attributes where compatible.
- Preserve other approved attributes in the existing Specifications field until a suitable structured storage mapping is available.
- Keep private information restricted through the existing `AssetPrivate` access rules.
- Do not automatically add every AI-suggested key to master Custom Fields.

An existing-schema compatibility check is required before finalizing structured attribute persistence.

---

## 5. AI Output Contract

The backend should normalize AI responses into a provider-independent structure resembling:

```json
{
  "category": {
    "value": "Desktop PC",
    "evidence": "HP Compaq 8200 Elite SFF PC",
    "source_image": "image_01",
    "status": "supported"
  },
  "brand": {
    "value": "HP",
    "evidence": "HP Compaq 8200 Elite SFF PC",
    "source_image": "image_01",
    "status": "supported"
  },
  "model": {
    "value": "Compaq 8200 Elite SFF",
    "evidence": "HP Compaq 8200 Elite SFF PC",
    "source_image": "image_01",
    "status": "supported"
  },
  "serial": {
    "value": "",
    "evidence": "",
    "status": "not_detected"
  },
  "attributes": [
    {
      "key": "processor",
      "label": "Processor",
      "value": "Intel Core i5-2400",
      "evidence": "Intel Core i5-2400 CPU",
      "source_image": "image_01"
    },
    {
      "key": "memory",
      "label": "Installed RAM",
      "value": "8 GB",
      "evidence": "8.00 GB",
      "source_image": "image_01"
    }
  ]
}
```

The exact JSON schema may be refined during implementation.

### Field status model

| Status | Meaning |
|---|---|
| Supported | Value is supported by recognizable source evidence |
| Inferred | Plausible interpretation, but not explicitly stated |
| Conflict | Multiple incompatible values exist |
| Not detected | Insufficient evidence |
| User confirmed | Human has approved the value |

AI-generated confidence alone must not be treated as verification. Evidence and deterministic checks take precedence.

---

## 6. Progressive Recognition UI

The user should not have to stare at one spinner until every API request finishes.

### Recognition stages

**Stage A — Capturing**

Show captured image and confirmation that it was received.

**Stage B — Reading label**

Show OCR processing status.

**Stage C — Preliminary information**

As soon as OCR and local parsing complete, populate available fields.

**Stage D — AI organizing**

Display AI progress without clearing the preliminary results.

**Stage E — Verification**

Show improved structured information, conflicts and matching results.

### UI feedback requirements

- Animated progress indicators for active stages.
- A visible checkmark when a stage completes.
- Partial results appear immediately when available.
- Field additions or corrections use subtle highlighting.
- Clear indication of OCR-derived versus AI-interpreted values.
- Expandable raw OCR and AI interpretation sections.
- Retry action on AI failure.
- No fabricated percentage-progress indicators.
- No blocking global spinner when useful results are already available.

The UI should display genuine updates as processing stages complete, not fake simulated recognition progress.

---

## 7. Recognition Result Screen

### Recommended hierarchy

**Section 1 — Recognition summary**

Show:

- Recognized asset type
- Brand and model
- Serial or strongest confirmed identifier
- Number of fields detected
- Missing or conflicting critical fields

**Section 2 — Main information**

Editable core asset fields.

**Section 3 — Technical specifications**

Group dynamic attributes under meaningful headings such as Hardware, Storage, Electrical, Network and Other, where supported.

**Section 4 — Source evidence**

Expandable original OCR, Groq field mapping, input photographs and evidence for selected fields.

**Section 5 — Existing asset reconciliation**

Show exact and possible matching records, followed by actions to review a match or create a new asset.

### Actions

- Confirm information
- Edit detected fields
- Add another photo
- Rescan
- Review existing matches
- Update existing asset
- Create new asset
- Cancel

Do not duplicate the same technical attributes unnecessarily in both the main fields and Specifications display.

---

## 8. Multi-Image Field Consolidation

When multiple images contain the same attribute, AssetHub must reconcile the observations.

### Matching values

If two images show the same serial number, retain the value and associate both evidence sources.

### Complementary values

If one image supplies a model and another supplies RAM specifications, combine them.

### Conflicting values

If sources disagree, do not silently choose one.

Display:

- Value from Image 1
- Value from Image 2
- AI suggestion, if available
- User-selectable final value

Conflicts involving identifiers must always require explicit review.

---

## 9. Universal Existing-Asset Matching

### Matching hierarchy

| Level | Evidence | Behaviour |
|---|---|---|
| 1 | Exact JCP Asset ID | Strongest direct lookup |
| 2 | Exact serial / Service Tag / IMEI within appropriate identifier type | Strong identifier candidate |
| 3 | Brand + model + category | Strong possible match, not a confirmed identity |
| 4 | Category + model + relevant specifications + location | Possible match |
| 5 | Partial model or shared specifications | Weak suggestion, shown only when useful |
| 6 | Brand alone | Insufficient to propose a meaningful duplicate |

Use identifier normalization without losing the original value.

A MAC address or generic model name should not independently trigger automatic record updates.

### Comparison view

For every candidate:

- Asset ID and name
- Category, brand and model
- Site and area
- Matching evidence
- Conflicting values
- Missing fields that could be completed

Possible-match lists should favour relevance over displaying numerous loosely related assets.

### Safety rules

- Never auto-merge fuzzy matches.
- Never overwrite conflicting values without confirmation.
- Never create a new record before checking appropriate existing candidates.
- Never treat an empty serial field as proof that an asset is new.
- Preserve activity and movement history during approved reconciliation.

---

## 10. Scan-to-Update Existing Assets

Users must be able to initiate a scan directly from Asset Details or Edit Asset.

Workflow:

1. Open the existing asset.
2. Tap Scan to Update.
3. Capture one or more source images.
4. Extract and organize the information.
5. Compare detected values with the selected existing record.
6. Display only actual changes or new information prominently.
7. Allow individual field approval.
8. Save approved updates.

Unchanged fields should remain untouched.

The interface must differentiate between updating an existing asset and merging two separate asset records.

---

## 11. Performance & Responsiveness

### Frontend

- Display existing cached asset data immediately.
- Keep Save and Review Match buttons disabled during their active operation.
- Show action-specific waiting and error states.
- Avoid full-page refresh after a successful update where the local state can be updated safely.
- Use background synchronization without blocking navigation.
- Support cancelling an in-progress recognition session where safe.

### Backend

- Avoid redundant OCR/API calls for the same unchanged image when cached results are available.
- Limit source text to what is needed for interpretation.
- Implement bounded retries for transient failures.
- Distinguish configuration, rate-limit, timeout and parsing errors.
- Preserve idempotency for asset creation and relevant update operations.

### Performance targets

Proposed acceptance targets to validate against the actual backend:

- Immediate visual response to every tap.
- Preliminary fields displayed when local parsing finishes, without waiting for Groq.
- Background AI enhancement must not block viewing OCR results.
- Long operations display continued-waiting feedback.
- Completed updates should appear without an unnecessary full refresh.

Actual OCR and AI processing times depend on image quality, service availability and network conditions.

---

## 12. Groq Integration and Failure Handling

### Configuration

Use Google Apps Script Script Properties:

- `GROQ_API_KEY`
- `GROQ_MODEL`

Do not expose credentials in browser-side JavaScript.

### AI provider strategy

- Groq is the preferred AI text-interpretation provider.
- OCR.Space remains the OCR provider.
- The local rule-based parser remains the fallback.
- Groq receives the relevant OCR text rather than automatically receiving the original image.
- Validate every returned object against the expected schema.

### Failures

| Situation | Required behaviour |
|---|---|
| No API key | Use local parser |
| Groq rate limit reached | Show AI unavailable; keep OCR results |
| API timeout | Allow retry or proceed manually |
| Malformed JSON | Reject invalid structured output; retain OCR |
| Low-confidence interpretation | Flag for review |
| OCR unreadable | Allow recapture or manual entry |
| Conflicting identifiers | Require manual resolution |

The system must not repeatedly retry rate-limited requests without bounds.

Free-tier quotas and provider rules must be checked before release. No automatic paid-service upgrade is permitted.

---

## 13. Privacy and Security

- Enforce Guest, Staff and Admin permissions at the backend.
- Keep `AssetPrivate` information out of Guest responses.
- Do not send unrelated private asset records to the AI.
- Do not expose API keys in Firebase.
- Treat OCR and AI content as untrusted input.
- Reject attempts to use OCR text as application instructions.
- Never execute code or follow URLs extracted from labels.
- Record significant asset modifications in ActivityLog.
- Minimize retention of unnecessary recognition text containing sensitive information.

---

## 14. Testing and Acceptance Criteria

### Recognition test coverage

Test at least these categories:

1. Desktop PCs and Windows About screens
2. Laptops
3. Monitors
4. Inkjet and laser printers
5. Dot-matrix printers
6. Mobile phones
7. Network devices
8. Payment or attendance terminals
9. Production equipment
10. Unfamiliar product labels

Also test:

- Multiple images of one device
- Poor lighting and blurry labels
- Unusual abbreviations
- Partially visible serials
- Missing serial numbers
- Conflicting model information
- OCR typos
- Repeated manufacturer names
- Duplicate-detection candidates
- AI disabled or rate-limited

### Release acceptance

V2.7 is acceptable when:

- A new device type can be processed without adding a product-specific parser.
- Standard fields are mapped with relevant source evidence.
- Dynamic technical information is retained.
- Multiple-photo observations can be consolidated.
- Unsupported serial numbers are not invented.
- A brand-only match does not create a false duplicate recommendation.
- Scan-to-update requires explicit confirmation.
- AI failure does not prevent manual asset onboarding.
- Visible progress and button feedback work on mobile.
- Existing V2.6 asset management, maintenance, audit and reports remain functional.

---

## 15. Development Scope and Order

### Phase 1 — Universal extraction engine

Implement provider-independent JSON structure, flexible fields, evidence validation and improved generic interpretation.

### Phase 2 — Progressive recognition interface

Implement genuine recognition stages, partial fields, AI result visibility and conflict indicators.

### Phase 3 — Multi-image consolidation

Allow multiple captured sources to contribute to one asset, with field provenance and conflict review.

### Phase 4 — Reconciliation integration

Improve identifier comparison, candidate ranking and scan-to-update review using the new data structure.

### Phase 5 — Regression testing and release

Test frontend, backend, existing assets, permissions, OCR, Groq and Firebase Preview before production deployment.

---

## 16. Out of Scope

The following are not required for V2.7:

- Training a proprietary AI model.
- Building hundreds of brand-specific parsers.
- Replacing Google Sheets with another database.
- Automatic destructive merging.
- Autonomous modification of asset records.
- Paid AI processing as a mandatory dependency.
- Full redesign of unrelated AssetHub pages.
- Changes to already working desktop scanning unless required for compatibility.

---

## 17. Final Expected Outcome

JCP AssetHub V2.7 should behave as a general-purpose equipment information interpreter.

**Any supported equipment image → OCR → AI organization → evidence validation → structured asset fields → matching → user confirmation → save.**

The system should improve the quality and consistency of asset records without assuming every AI response is correct.

**Release principle:** Preserve what works in V2.6, introduce the universal detector as a coherent subsystem, and verify it before production deployment.