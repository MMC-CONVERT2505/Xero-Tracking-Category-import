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
- **No exact match** -> `NOT_FOUND` at preflight time. Nothing is created
  yet - the Import Summary shows a **"Continue Import"** action per such
  category. Only when the user clicks it does
  `POST /api/tracking/import/resolve-category` call
  `trackingCategoryService.resolveOrCreateCategory`, which re-checks Xero
  one more time (inside a lock - see below) before actually creating
  anything, then flips that group to `FOUND` with `wasCreated: true`.
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
