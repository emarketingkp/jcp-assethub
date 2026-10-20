# Equipment sets and grouped asset register

Build `2.7-asset-groups-1`, based on merged main `b960205`. API version stays
`2.7`; write support is advertised separately by `features.asset_groups`.
Included in production build `2.7-fast-entry-1`, released on 2026-10-20.
The owner deployed the grouping backend before the Hosting release.

## Staff workflow and identity rules

| Situation | UI and stored result |
| --- | --- |
| A PC station with peripherals | One named **equipment set** expands into its existing/new PC, monitor, keyboard and mouse records. The set header is not an extra asset. |
| Many identical items with different serials | One **same-model** row expands into separate tagged units. Shared details are entered once; each serial is entered separately. |
| Same product/part code printed on every item | Enter it in **Shared product / part code**. It becomes shared specifications, not a unique serial. |
| Unreadable/unmarked serial | Leave it blank. Each physical item still receives a unique JCP tag. |
| Brand/model not marked | Batch/set entry accepts the category without inventing brand or model. Similar incomplete records can share a clearly labelled **Product details incomplete** display bucket; this does not assert that their models are identical. |
| A record already exists | Choose **Already in AssetHub** or **Group existing assets**. It is linked, not recreated. Its serial, location, assignment, photos, private information and history are retained. |
| Same nonblank serial on two records/items | Flag for review; keep existing records separate. Reject duplicate serials in new batches. No automatic record merge. |

The default register groups sets first, then matching category/brand/exact model
and shared specification text for unassigned units. Model punctuation, capacities
and other specification differences remain separate. Known labelled per-unit
identifiers (serial, IMEI, MAC, service tag, hostname, device ID and asset ID) do
not split a model group and are removed from a copied product template. Free-form
specifications still need review; they are not an identity classifier.

Search and filters run on physical units before grouping. Searching a serial or
JCP tag opens the relevant group and shows the matching unit. Headers state when
only part of a loaded set/model group matches filters. Totals count physical
records, not headers. The ungrouped List/Grid views remain available.

### Fewer entry steps

1. **Add multiple / set** offers Same model items, Equipment set, or Group existing
   assets. Single-asset creation and existing scan flows remain available.
2. Same-model entry collects product details, shared part code, site/area,
   assignment, initial status and required custom values once. Set entry has a
   PC + monitor + keyboard + mouse starting layout; staff can remove/add rows or
   select existing records. Choosing a preset does not fill in unknown brands,
   models or serials.
3. Review lists each new/existing unit, missing serial counts, common placement,
   status and shared specs. A checkbox explicitly confirms the physical units
   or membership/name change before any write.
4. The register opens the saved group. Each unit opens its normal detail page.
   Add new/link existing/rename actions belong to the set header. Remove from
   set lives in the unit's `⋯` menu and has its own review; it does not delete it.

**Add units / Add same model** copies shared product details into a fresh draft.
It clears serials, JCP IDs, membership, photos, assignment, placement, private
values and history. Placement is an explicit choice for the new items. Required
custom information can be entered once for the new batch; existing records are
not overwritten with it. Batch photos are added later per unit to avoid applying
one device's label photo to every item.

An item belongs to at most one physical equipment set. Adding an item from
another set is blocked until staff explicitly removes it from that set. Set
names cannot duplicate another set name. Merging a source from a different set
requires explicit unlinking first, avoiding a hidden membership loss. A set is
a relationship, not a bulk movement: changing a set does not move its units.

## Implementation and compatibility

- `public/asset-groups.js`: pure grouping/index/template/identity helpers. A Map
  index is reused while the asset snapshot is unchanged. Repeated summaries of
  the same JCP ID display once; different JCP records retain their identities.
- `public/group-entry.js`: guided entry and explicit review. Shared same-model
  fields are transmitted once; rows carry just their serials. Unknown identity
  data is left empty. Pending requests are stored per signed-in account on the
  device, without session tokens or private account fields. An unconfirmed save
  must be reviewed/resumed before beginning another batch for that account.
- `public/app.js`, `index.html`, `app.css`: expandable groups, filtered counts,
  status summaries, action menus, existing-item links and template entry. Groups
  render 25 units at a time; the register initially renders 50 display entries.
  Collapsed groups do not request unit bundles or photos. Grouping adds no AI
  calls and no per-unit read requests to construct the list.
- Scanner results distinguish similar-model records with different serials from
  identity matches. Exact JCP/serial/typed identifier evidence still leads to
  review. A similar model alone is explicitly not proof of a duplicate.
- Existing unmarked units can be edited without entering a fabricated model.
  Normal single-asset create requirements and manual QR workflow are retained.
- Build/service-worker cache changes include both new frontend modules. Grouping
  views work with the old backend; new writes remain unavailable until schema
  and helper code advertise capability. Flags refresh through bootstrap and sync.
- `apps-script/Code.gs`: adds optional `set_id` and `set_name` columns plus the
  `AssetBatches` schema, capability flags, and the Staff-only `saveAssetBatch`
  action. Important asset updates/reconcile/merge/retire use the same script lock
  as batch writes. Legacy/image updates do not rewrite membership columns absent
  from their patch. Spreadsheet user text beginning with `=` is escaped as a
  literal. Backend JCP lookup accepts current timestamp tags and links without
  requiring a browser `URL` implementation.
- `apps-script/AssetGroups.gs`: additive setup, strict request validation,
  snapshot checks, planned JCP allocation, batch persistence, narrow set-column
  writes and audit logs. All operational group actions require Staff/Admin;
  Guest single-asset creation and restricted photo grants are unchanged.
- `tests/fixtures/sheets-harness.cjs`: actual Apps Script functions run against
  spreadsheet primitives in memory. Browser batch tests call those functions
  through a bridge instead of reimplementing the group-save rules in a mock.
  CI syntax-checks every Apps Script `.gs` file.

### Retry and persistence contract

Each reviewed submission has a UUID and a server-computed fingerprint bound to
its authenticated actor. Under the script lock, the server validates required
data and all selected asset timestamps, reserves individual JCP IDs in the
`AssetBatches` ledger, and then writes new asset rows in a batch. IDs reserved by
another prepared request cannot be reused. Existing item links write only set
columns and update metadata. New identifier rows use plain-text formatting,
preserving leading zeros and long numeric strings.

The ledger stores `request_id`, `actor`, `fingerprint`, `plan_json`, `state`,
`created_at`, and `updated_at`; it contains no authentication tokens. A retry
checks the same request/actor/fingerprint, appends only missing planned records,
fills missing custom rows and adds missing audit entries. A completed request
returns current stored records without replaying old membership changes. If
asset source references exist but the ledger disappeared, the server refuses to
recreate the batch. Do not delete the ledger to recover from an error.

Sheets writes across multiple ranges/sheets are **not a transaction**. A failure
can leave visible partial results until the same request finishes. The UI keeps
the approved payload and offers a retry, including after a page reload. It does
not generate a new request or silently fall back to repeated `createAsset` calls.
If the server proves a request did not start, the draft can be edited. A prepared
request with a later conflicting edit needs administrator review; do not bypass
it by starting the batch again or deleting rows/ledger entries.

## Owner's Apps Script rollout

Do this first against an isolated spreadsheet/Drive copy. A Firebase preview
using the production Apps Script URL is not isolated from production data.

1. Back up the spreadsheet and current Apps Script deployment/version. Keep
   identifier columns and existing JCP tags intact.
2. Replace the project's `Code.gs` with this branch's file. Add a second Apps
   Script file named **AssetGroups** and paste `AssetGroups.gs` into it. Keep
   existing Script Properties and `appsscript.json` scopes unchanged.
3. Run **`setupAssetGrouping()`** once as the owner. It adds missing `set_id` and
   `set_name` headers to Assets and creates the empty AssetBatches ledger. It
   does not create sets, merge rows, change serials, seed an administrator or
   rewrite historical records. It is safe to run again. Use this function rather
   than the original full `setupDatabase()` for this additive rollout.
4. Update the Web App deployment to a new version, retaining its existing URL,
   execution identity and access settings. Ensure both `.gs` files are present.
5. Check bootstrap/sync advertises `features.asset_groups: 1`, then reload the
   frontend. Missing helper/schema advertises `0`; the grouped view still works
   while saving groups remains disabled.
6. On test data, verify one mixed PC set, one blank/different-serial batch,
   existing-item linking/unlinking, rename, duplicate rejection, exact serial
   round trips, and a lost response/retry. Confirm audit/history/photos/private
   sheets were not reassigned or overwritten. Test Staff/Admin and Guest denial.
7. After owner review, merge the PR. Production Hosting deployment still requires
   approval; stage the merged frontend with the correct `/exec` URL, never the
   intentionally blank repository config. Verify build, API flags, filtered
   counts and a real staff-device flow. Keep the previous Hosting/Apps Script
   versions and the full spreadsheet backup for rollback.

Do not remove the additive columns/ledger when rolling back code. An old backend
can rewrite rows and does not enforce new group constraints, so disable group
changes during rollback and restore/review data from the backup if necessary.

## Validation and remaining limits

Follow-up frontend optimizations and faster batch entry are documented in
[PERFORMANCE_AND_FAST_ENTRY.md](PERFORMANCE_AND_FAST_ENTRY.md). Broad searches
now keep groups compact; up to 25 matching physical items open automatically.

Automated checks cover unique physical counts, set/model/incomplete group
projection, different/missing/repeated serials, unknown models, variant separation,
identity-free templates, actual backend batch creation, partial writes, lost
replies/reload, ID reservation, request/actor binding, stale records, old schema,
Guest denial, literal spreadsheet text, long numeric serials, timestamp tags,
set-safe existing updates, cross-set merge blocking and ledger-loss refusal.
Mobile/desktop browser tests exercise real frontend code and the actual backend
functions via the isolated harness. Existing scanner, photo-retry, permissions,
offline barcode and manual desktop workflows remain in the regression suite.

Verification on 2026-10-19: **55 unit/backend checks and 32 browser scenarios**
passed (33 browser TAP entries including the parent test). All frontend/backend
JavaScript syntax checks and whitespace checks passed. Tests use synthetic data;
there are no live database writes in this validation.

A separate read-only projection of the current register on 2026-10-19 kept all
91 physical summaries and produced 54 display rows (12 known-model groups,
3 incomplete-product buckets, 39 individual rows). No repeated nonblank serial
values were found by the existing normalized comparison. This was a projection,
not a migration or deployment; raw production summaries remain outside Git.

```sh
npm ci
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
for file in public/*.js; do node --check "$file" || exit; done
for file in apps-script/*.gs; do node --check < "$file" || exit; done
git diff --check
```

The system Chromium path is optional when Playwright's browser is installed.

Remaining limits:

- No production Apps Script execution or live Sheets/Drive writes were performed.
  The spreadsheet harness does not reproduce Google's latency, quotas, cell
  coercion or all concurrency behavior. Validate actual copied-sheet serial
  round trips and multi-user behavior before release.
- Physical Android/iPhone usability and camera/provider performance still need
  staff-device acceptance. No grouping-related OCR/AI request is added.
- The existing register loads up to 1,000 summaries. Counts are explicitly scoped
  to loaded, filtered items; a future server-paged register is separate work.
  Model grouping is conservative: differently written specs or missing specs
  can leave separate groups. Missing product identity is labelled, never guessed.
- Batches create/link at most 25 units, with 32 KiB UTF-8 request data. Complete
  set renames allow at most 250 components and a 45,000-character retry plan;
  very large sets need an administrator to review these limits. These constraints
  avoid unbounded work and oversized spreadsheet cells.
- No quantity-only stock ledger, nested sets, bulk movement, set-wide audit
  verification, per-row photo batch, or persisted shared model catalog is added.
  Existing movement/audit/maintenance remain per physical unit.
- Pending retries depend on browser storage. If it is cleared, do not resubmit
  an unconfirmed blank-serial batch as a new batch: review the saved records and
  AssetBatches first. Unrelated new requests for unlabelled physical items cannot
  be proven duplicates automatically. Direct manual sheet changes and external
  scripts do not participate in the application lock.
- Exact serial formatting is enforced for newly appended batch rows. Historical
  lost zeros cannot be recovered automatically, and existing single-asset writes
  still need the plain-text column checks noted in the scanner handoff.
- Retain the retry ledger. It grows over time; any future archival strategy must
  preserve idempotency and reserved IDs. No automatic deletion is included.

Synthetic UI screenshots (no real asset data; the mobile full-page capture hides
fixed navigation/notification overlays for readability):

- [Mobile equipment set](assets/grouped-set-mobile.png)
- [Desktop grouped models](assets/grouped-models-desktop.png)
