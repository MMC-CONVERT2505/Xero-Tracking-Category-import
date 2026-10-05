# Xero API verification (section 31 of the spec)

Before writing the batching layer, the current Xero Accounting API contract
for the Tracking Options endpoint was checked against Xero's published
documentation and connector references (accessed 18 Sep 2026).

## `PUT /api.xro/2.0/TrackingCategories/{TrackingCategoryID}/Options`

**Finding: this endpoint accepts exactly ONE tracking option object per
request. It does not accept a bulk array of options.**

Request body:
```json
{ "Name": "Sales" }
```

Confirmed details:
- `Name` is required, max 100 characters.
- An optional `Idempotency-Key` header is supported, allowing safe retries
  without duplicate creation - this tool uses it (see
  `trackingOptionService.buildIdempotencyKey`, derived deterministically
  from `importId + normalized option name`).
- The response echoes the created option (including its new
  `TrackingOptionID`) inside a `TrackingCategories`/`Options` structure.

## Design consequence

Because bulk creation is not available, `BATCH_SIZE` (default 50, see
`config/constants.js`) is **not** an HTTP request batch size - it is purely
a bookkeeping grouping used for progress reporting and resumability.
Every option is still sent as its own HTTP call, but those calls are never
fired all at once: they go through
- `services/queueService.js` - caps concurrency at `XERO_MAX_CONCURRENT_REQUESTS` (default 5) per tenant
- `services/rateLimiter.js` - token bucket capping `XERO_MAX_REQUESTS_PER_MINUTE` (default 60) per tenant
- `services/retryService.js` - exponential backoff + `Retry-After` handling on 429s, with a hard cap of `MAX_RETRIES` (default 5)

This satisfies section 32 of the spec: "10,000 options" becomes 10,000
individually-tracked, rate-limited, resumable requests - never
`Promise.all(10000)`.

## Reading Xero's real error responses

A failed option create only ever surfaces Axios' generic
`error.message` ("Request failed with status code 500") if nothing more
specific is read from `error.response`. `utils/xeroErrorParser.js` reads
Xero's actual documented Accounting API error shape instead:

```json
{
  "ErrorNumber": 10,
  "Type": "ValidationException",
  "Message": "A validation exception occurred",
  "Elements": [{ "ValidationErrors": [{ "Message": "<the real, specific reason>" }] }]
}
```

The top-level `Message` is only ever the generic wrapper string for a
`ValidationException` - the specific, useful reason lives in
`Elements[].ValidationErrors[].Message`. For a 500 with no Xero JSON body
at all (e.g. a gateway-level failure that never reached Xero's own
application code), a short snippet of the raw response body is captured
instead of nothing. The parser reads only `err.response` - never
`err.config` (where Axios keeps the outgoing request's Authorization
header) - so there is no code path by which a token could end up in a
persisted error message or a log line; verified in
`test/smoke9_error_detail.js` by injecting a fake token into `err.config`
and asserting it never appears in the report or logs.

## Other endpoints used

| Endpoint | Verified behaviour |
|---|---|
| `GET /TrackingCategories?includeArchived=true` | Returns all categories (Status: `ACTIVE` / `ARCHIVED`), used to resolve a category by name and to enforce the 2-active-category limit. |
| `GET /TrackingCategories/{id}` | Returns a single category **including its current `Options` array** (active + archived) - used for the existing-options diff, avoiding a separate "list options" call. |
| `PUT /TrackingCategories` | Creates a new category (`{ "Name": "..." }`), only called when the category truly doesn't exist and the active-category limit allows it. |

If Xero later ships a genuine bulk-options endpoint, only
`xeroClient.createTrackingOption` and the loop in
`trackingBatchService.processJob` need to change - the queue/rate-limiter/
retry/persistence layers are agnostic to batch-vs-single-call.

## OAuth 2.0 / token storage

- One access+refresh token pair is issued per Xero **login**, and can cover
  **multiple organisations** if the user has access to more than one (Xero
  returns them all from `GET /connections` after token exchange).
- Xero refresh tokens are **single-use and rotate on every refresh**. If two
  tenants under the same login each held their own copy of the token and
  refreshed independently, the second refresh would fail with
  `invalid_grant`. This tool stores exactly **one** token set per login
  (`connectionId`) and maps every tenant under it to that same
  `connectionId` (`tenantIndex.json`), so a refresh happens once and every
  tenant benefits - see `services/xeroConnectionService.js`.
- Refreshing is additionally guarded by a per-connection mutex
  (`categoryLockService.withLock`, reused generically) so two concurrent
  requests near expiry can't both trigger a refresh and race each other.
  Verified in `test/smoke3.js`.
- Because tokens are keyed by tenantId (not by browser session), a
  background import job keeps refreshing its own token and making progress
  for hours even if the browser that started it is closed or the session
  cookie expires.

## Diagnosing the dashboard 429 (and why option pushes were unaffected)

`xeroClient.js` has four functions that call Xero, but only one of them -
`createTrackingOption` - was ever rate-limited or retried. That protection
lives OUTSIDE `xeroClient.js` entirely, in
`trackingBatchService.attemptOption` (`rateLimiter.acquire` +
`retryService.withRetry` wrapped around the call there). The other three -
`listTrackingCategories`, `getTrackingCategory`, `createTrackingCategory` -
had no protection at all. They're called from interactive requests
(`GET /api/xero/dashboard`, `GET /api/xero/tracking-categories`, category
resolution) that run independently of, and concurrently with, a large
background import that's already consuming most of the tenant's Xero call
budget through the (correctly) rate-limited option-creation path. When the
combined traffic pushed the tenant over Xero's real per-minute limit, one
of these *unprotected* calls could receive a genuine 429 straight from
Xero, and - having no retry wrapper at all - the raw Axios error
(`"Request failed with status code 429"`) propagated straight through
`errorHandler.js` to the frontend. This is why no 429 ever appeared in the
import's own batch logs: the import's calls were never the ones failing
unprotected.

**Fix**: `listTrackingCategories`, `getTrackingCategory`, and
`createTrackingCategory` now go through the exact same, unmodified
`rateLimiter`/`retryService` as option creation (via a new `callProtected()`
wrapper in `xeroClient.js`), so all four functions draw from the same
per-tenant budget and a transient 429/500 on any of them is absorbed by
the same proven backoff logic instead of reaching the user.
`createTrackingOption` itself is untouched - still wrapped only
externally, exactly as before; verified in `test/smoke10_429_dashboard_fix.js`
(Part A) by counting its raw attempt count directly at the `xeroClient`
layer.

**Temporary diagnostic logging** (`[XERO_CALL]` lines, in `xeroClient.js`'s
`withDiagnostics()`) was added to every one of the four functions, safe to
delete once no longer needed. Each line names which of our own routes
triggered it (`"GET /api/xero/dashboard"`, or `"background-import"` for
calls with no active request - via `middleware/requestContext.js`'s
`AsyncLocalStorage`), the Xero method/path called, the status, and Xero's
own rate-limit response headers (`X-MinLimit-Remaining`,
`X-DayLimit-Remaining`, `X-AppMinLimit-Remaining`, `Retry-After`) - which
only ever appear on responses that actually came from Xero's API gateway,
making them the clearest signal for telling a genuine Xero rate limit
apart from anything else. Only `err.response`/`res.headers` are ever read
for this - never `err.config` (where Axios keeps the outgoing
Authorization header) - so a token cannot end up in these lines; verified
by injecting a uniquely-named fake token and asserting it never appears in
any logged line.

## Diagnosing a 500 with no error body (empty Xero response)

`xeroErrorParser.js` originally only distinguished "has a `Message` field"
from "doesn't" - a 500 with a genuinely empty response body (no JSON at
all, e.g. from a gateway/load-balancer failure that never reached Xero's
own application code, which is a well-known real-world case for
transient 500s) fell through to `null` for every field, with no way to
tell that apart from "we have a body but don't recognize its shape."

The parser now explicitly distinguishes three cases, in order:
1. **No response at all** (`err.response` doesn't exist - a timeout,
   `ECONNRESET`, DNS failure, etc.) - the request may never have reached
   Xero. Message: `"Xero request failed before a response was received (<code>)"`.
2. **A response exists, but the body is empty** (`undefined`/`null`/blank
   string/`{}`) - Xero's gateway responded, but there's no JSON error to
   read. Message: `"Xero returned HTTP <status> with an empty response body"`
   (exactly the wording requested for this case).
3. **A response with an unrecognized non-JSON body** (HTML, plain text) -
   a short, safe snippet of it is captured instead of nothing.

All three cases, plus Xero's rate-limit headers, are included in both the
per-option persisted `optionResult` and the `[IMPORT_ERROR]` structured
log line, so a future empty-500-body failure is immediately distinguishable
from a validation failure or a genuine network error without re-deriving
any of this by hand.

## Category typo/mismatch confirmation

Reuses the Levenshtein-based `findClosestActiveCategory` helper (built in an
earlier round for a "did-you-mean" suggestion, then unused when auto-create
was requested instead) to gate auto-creation behind an explicit choice
whenever a detected category is close enough to an existing one to plausibly
be a typo, instead of always auto-creating on no exact match:

- **Exact match** (case/whitespace-insensitive - "class" matches "Class"):
  `FOUND`, unchanged from before.
- **No exact match, no close match**: `NOT_FOUND`, unchanged from before -
  a single "Continue Import" click, no decision required, auto-creates.
- **No exact match, but a close match exists** among ACTIVE categories
  (same threshold as before: edit distance <= `max(2, ceil(length * 0.25))`):
  `POSSIBLE_MISMATCH`. `resolveCategory()` now REQUIRES an explicit
  `decision` for this status - `'use_existing'` (reuses the suggested
  category, never creates anything) or `'create_new'` (creates the name
  EXACTLY as uploaded, never silently corrected to the suggestion). No
  default: an unresolved mismatch simply cannot reach `startImport` - it's
  skipped, same mechanism as any other not-yet-resolved category.
- **Xero's real 2-active-category limit** is checked proactively at
  classification time (not just when `resolveOrCreateCategory` itself
  would reject it) so the UI can greatly out "Create new" with a clear
  reason up front, while "Use existing" (a reuse, not a creation) still
  works even at the limit.

**Persistence**: the pre-confirmation state is deliberately NOT persisted
beyond the existing in-memory `pendingUploads` map (documented at the top
of `trackingImportService.js`) - nothing has been written to Xero yet at
that point, so a restart simply invalidates the `uploadToken` and the user
re-uploads. This is in fact the safest possible behaviour for "must not
auto-create after a restart": there is no persisted intent to resume, so
nothing can be created from stale state. Once a decision IS made, it flows
straight into the same already-persisted, already-restart-proof `ImportJob`
creation path every other category resolution uses - no separate
persistence layer was added or needed.

## Category auto-detection & auto-creation

The category is never typed or picked from a dropdown - it's read from the
first column's header of each sheet (`excelParserService.parseAutoDetectCategories`)
and matched against the tenant's real Xero categories
(`trackingImportService.classifyGroup`):

- **Exact match, ACTIVE** -> `FOUND`, resolved immediately, reused as-is.
- **Exact match, ARCHIVED** -> always blocked. There is deliberately no
  "create/import anyway" override for this case, anywhere in the API - see
  `test/smoke2.js`'s assertion that `resolveCategory` throws
  `CATEGORY_ARCHIVED` and the group never reaches `startImport`.
- **No exact match, and nothing close enough to be a plausible typo** ->
  `NOT_FOUND` at preflight time. Nothing is created yet - the Import
  Summary shows a **"Continue Import"** action per such category. Only
  when the user clicks it does `POST /api/tracking/import/resolve-category`
  call `trackingCategoryService.resolveOrCreateCategory`, which re-checks
  Xero one more time (inside a lock - see below) before actually creating
  anything, then flips that group to `FOUND` with `wasCreated: true`.
- **No exact match, but something close enough to be a plausible typo** ->
  `POSSIBLE_MISMATCH` instead of `NOT_FOUND` - see "Category
  typo/mismatch confirmation" above for the explicit-choice flow this
  triggers instead of auto-creating.
- The client never sends a raw `trackingCategoryId` to resolve a category -
  only the opaque group `key` from `/validate`'s own response. The server
  looks up its own record of what that group is and resolves/creates the
  category itself. This closes off a tampered request trying to redirect
  an import into an arbitrary category.

### Category creation race safety

Two imports for the same tenant can detect and try to create the same new
category name at the same moment (e.g. two people uploading similar files,
or a retried request). `trackingCategoryService.resolveOrCreateCategory`
is guarded by the same generic keyed mutex used for OAuth token refresh
(`categoryLockService.withLock`, keyed by `tenantId::normalizedCategoryName`),
and re-searches Xero's live category list **after** acquiring the lock -
so whichever caller loses the race for the lock simply finds the
category the winner just created, instead of creating a second one.
On top of the in-process lock, the resolved ID is cached durably to
`backend/data/categoryLocks.json`, so this also holds across a server
restart (a resume, or a second upload of the same file, reuses the
persisted ID rather than re-creating). Verified end-to-end in
`test/smoke6_autocreate_race_resume.js`: two concurrent `resolveCategory`
calls for a brand-new name trigger exactly **one** `createTrackingCategory`
call and both resolve to the identical ID; a fresh `require()` of the
service (simulating a restart) reuses the persisted ID with zero further
creation calls.
