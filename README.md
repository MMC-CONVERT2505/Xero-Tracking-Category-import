# Xero Tracking Categories & Options Import Tool

A production-shaped SaaS app for bulk-importing Tracking Options (500 -
20,000+) into Xero Tracking Categories from an Excel/CSV file - with real
Xero OAuth login, organisation switching, a live dashboard, and an import
engine that never floods Xero's API or loses progress. A detected category
that already exists in Xero is reused; one that doesn't is created
automatically (safely, even under concurrent imports - see "Important data
rule" below).

Stack: **Node.js + Express** backend, **React (Vite) + Tailwind CSS** frontend.

## The user flow

```
Landing page -> "Connect Xero" -> Xero login & consent -> (org picker,
if more than one) -> Dashboard -> Upload Tracking File -> Tracking
Category auto-detected per sheet & matched against Xero (created
automatically if it doesn't exist yet, on confirmation) -> review Import
Summary -> Start Import -> live progress -> completion screen ->
download error report / retry failed / import more
```

Nowhere does the user type a tenant ID, an access token, or a Tracking
Category ID/name - every identifier is resolved server-side from an
authenticated Xero session or auto-detected from the file itself and
matched against real Xero data. The user only has to intervene to confirm
creating a category that doesn't exist yet ("Continue Import") - see
"Excel/CSV format" below.

## Why this isn't a simple loop

`PUT /TrackingCategories/{id}/Options` only accepts **one** option per
request (verified - see `docs/API_DECISIONS.md`). So 10,000 options really
does mean 10,000 HTTP calls. The engine makes that safe:

```
Upload (500-10,000+ rows, 1 or many sheets, category auto-detected per sheet)
   -> Parse each sheet - first column's header names the category, the
      rest of that column is its options
   -> Normalize + dedupe (case/whitespace-insensitive)
   -> Resolve each detected category against Xero: reuse if it exists,
      create it (once, lock-protected) if it doesn't
   -> Diff against Xero's existing options -> only the NEW ones are queued
   -> Split into batches (bookkeeping only, default 50/batch)
   -> Queue (max 5 concurrent per tenant) + rate limiter (max 60/min per tenant)
   -> Retry transient errors (429/500/502/503/504, timeouts) with backoff;
      429 respects Retry-After. Permanent errors (400/401/403/404) fail
      immediately, no retry.
   -> Every batch/option result is persisted to disk as it happens
   -> Crash or restart? The server re-attaches to any PROCESSING job on
      boot and continues from the first PENDING/failed option - never from zero.
```

## Authentication

Real Xero OAuth 2.0 (authorization code + refresh), session-cookie based:

```
GET  /auth/xero               "Connect Xero" button lands here, redirects to Xero
GET  /auth/xero/callback      exchanges the code, discovers organisation(s),
                               auto-selects if there's only one, otherwise sends
                               the browser to /select-organisation
POST /auth/xero/logout        clears the session (does NOT stop background imports)
GET  /auth/xero/session       { authenticated, selectedTenantId } - used by the
                               frontend's route guard
```

The frontend never sees a client secret, access token, or refresh token -
only a `tenantId` and org name, read from `req.session` on the backend.
See `docs/API_DECISIONS.md` for why tokens are stored per-login
(`connectionId`), not per-tenant or per-session, and how that keeps
multi-hour imports refreshing correctly even after the browser session
that started them is gone.

## Project layout

```
backend/
  src/
    config/constants.js         all tunables (batch size, retry count, rate limits...)
    models/                     JSDoc shape docs for ImportJob/ImportBatch/ImportItem/XeroConnection
    db/store.js                  file-backed persistence (jobs, batches, results, Xero connections)
    services/
      xeroAuthService.js          stateless OAuth 2.0 mechanics (authorize URL, token exchange/refresh)
      xeroConnectionService.js    token storage, tenantId->connection index, session-safe refresh
      xeroClient.js                raw Xero Accounting API calls
      trackingCategoryService.js  resolve-or-create a category by name (locked, cached, race-safe)
      trackingOptionService.js    existing-option diff + single-option create (idempotent)
      excelParserService.js       multi-sheet XLSX/XLS/CSV -> flat record list
      categoryLockService.js      generic keyed mutex (used for both category creation and token refresh)
      queueService.js              per-tenant concurrency cap
      rateLimiter.js                per-tenant token-bucket rate limit
      retryService.js               retry/backoff policy
      trackingImportService.js    orchestration: validate -> start -> resume -> retry -> cancel
      trackingBatchService.js     batch/option processing loop (engine unchanged; error capture improved)
    utils/xeroErrorParser.js      extracts Xero's real error detail from a failed request (see docs/API_DECISIONS.md)
    routes/        authRoutes.js, xeroRoutes.js, trackingRoutes.js, importRoutes.js
    controllers/   authController.js, xeroController.js, importController.js
    middleware/    session.js, requireAuth.js, requireTenant.js, upload.js, errorHandler.js, requestContext.js (temporary Xero-call diagnostics)
frontend/
  src/
    pages/          Login, OrganisationSelect, Dashboard, TrackingCategories,
                     TrackingCategoryDetail, TrackingImport, ImportProgressPage,
                     ImportHistory, Connections, Settings
    components/     Sidebar, Header, AppLayout, StatCard, TrackingCategoryCard,
                     FileUploader, ImportSummary, ProgressBar, StatusBadge,
                     LoadingSkeleton, EmptyState, Modal, ProtectedRoute, icons
    services/       authApi.js, xeroApi.js, importApi.js
    context/        AuthContext (session state), ToastContext (notifications)
docs/
  API_DECISIONS.md       Xero API + OAuth token-storage verification write-up
  postman_collection.json
```

## Setup

### 1. Create a Xero app
Create an app at https://developer.xero.com/app/manage with the
**Accounting API** scope `accounting.settings` (+ `accounting.settings.read`,
`offline_access`, `openid profile email`). Set its redirect URI to
`http://localhost:7005/auth/xero/callback`.

### 2. Backend
```bash
cd backend
cp .env.example .env        # fill in XERO_CLIENT_ID / XERO_CLIENT_SECRET
npm install
npm start                   # http://localhost:7005
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5005 (proxies /api and /auth to :4000)
```

Open `http://localhost:5005`, click **Connect Xero**, and log in with your
Xero credentials. That's it - no tenant ID, no token, ever.

> Note: `vite.config.js`'s dev proxy only forwards `/api`. Since `/auth/*`
> routes involve a full-page redirect (not an XHR), the frontend calls
> them via an absolute-path browser navigation
> (`window.location.href = '/auth/xero'`) which the Vite dev server also
> proxies correctly because the proxy config matches `/auth` too - see
> `frontend/vite.config.js` if you rename backend routes.

## Excel/CSV format

There is no category picker - the Tracking Category is auto-detected from
each sheet's own structure. The **header of the first column is the
category name**, and every non-empty cell below it is one option:

| Class |
|---|
| 2020PART00001 |
| 212F00001 |
| 212F00002 |

This sheet is detected as category **Class** with 3 options. Only the
first column is read for auto-detection - extra columns are ignored.

**Multiple sheets, same category** - merged automatically into one job:
```
Sheet 1: Class -> [ABC, DEF]      Sheet 2: Class -> [GHI, JKL]
                     |
                     v
        ONE "Class" import job with [ABC, DEF, GHI, JKL]
```

**Multiple sheets, different categories** - each resolved and imported
independently, as its own job:
```
Sheet 1: Class    -> matched to Xero's "Class" category    -> job 1
Sheet 2: Location -> matched to Xero's "Location" category -> job 2
```

**If a detected category doesn't exist in Xero**, nothing is silently
guessed. The Import Summary shows it as **Not Found**, with a
**"Continue Import"** button - clicking it creates that exact Tracking
Category in Xero (under a lock that prevents two simultaneous imports
from creating it twice, see below), then the card updates to show it as
created, with its option counts, ready to include in the import. A
category that exists but is **archived** in Xero is always blocked
instead - never auto-created over, never reused, no override exists for
this case anywhere in the API (see "Important data rule" below).

## Important data rule: TrackingCategoryID is the source of truth

Once a category is resolved - whether it already existed, or was just
created via "Continue Import" - the backend persists its
`TrackingCategoryID` **once**, and every sheet, batch, and retry for that
import job reuses that exact ID - never re-resolved, never re-created,
never inferred from a sheet name or row. Two simultaneous imports
detecting the same new category name are protected by the same keyed
mutex used elsewhere in this codebase for OAuth token refresh
(`categoryLockService.withLock`, keyed by `tenantId::normalizedName`) plus
a durable, restart-proof cache in `backend/data/categoryLocks.json` - so
even a second upload of the same file, or a resume after a server
restart, finds the same ID instead of creating a duplicate. See
`trackingCategoryService.resolveOrCreateCategory` and
`docs/API_DECISIONS.md`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/xero` | Start OAuth login |
| GET | `/auth/xero/callback` | OAuth callback (redirects to frontend) |
| POST | `/auth/xero/logout` | Clear session |
| GET | `/auth/xero/session` | `{ authenticated, selectedTenantId }` |
| GET | `/api/xero/connections` | Organisations available on this session |
| POST | `/api/xero/select-connection` | `{ tenantId }` - verified against the session's authorized orgs |
| GET | `/api/xero/current-connection` | Currently selected org |
| GET | `/api/xero/dashboard` | Live stats: categories, active options, recent imports |
| GET | `/api/xero/tracking-categories` | List categories (active + archived) |
| GET | `/api/xero/tracking-categories/:id/options` | List one category's options |
| POST | `/api/tracking/import/validate` | Upload + auto-detect categories + preflight (multipart: `file` only) |
| POST | `/api/tracking/import/resolve-category` | `{ uploadToken, key }` - "Continue Import": finds-or-creates one NOT_FOUND category |
| POST | `/api/tracking/import/start` | `{ uploadToken }` - creates one job per resolved (FOUND) category, returns immediately |
| GET | `/api/tracking/import` | List this tenant's import jobs |
| GET | `/api/tracking/import/:importId/status` | Poll progress |
| GET | `/api/tracking/import/:importId/errors` | Per-option error report |
| POST | `/api/tracking/import/:importId/retry-failed` | Re-attempt only currently-failed options |
| POST | `/api/tracking/import/:importId/resume` | Re-attempt any pending/failed work (used after a crash) |
| POST | `/api/tracking/import/:importId/cancel` | Stop scheduling further batches |

All `/api/xero/*` (except connection-management) and all `/api/tracking/*`
routes require a selected organisation (`requireTenant` middleware) - the
tenantId always comes from the session, never from the request body or
query string. See `docs/postman_collection.json` for ready-to-use requests
(note: Postman can't complete the interactive OAuth redirect itself - log
in via a real browser first, then copy the session cookie).

## Testing performed

Automated (`backend/test/`, all stub the Xero network layer so they run
without real credentials):

- **`smoke.js`** (Test 1 + 3) - category already exists in Xero: reused
  as-is (never re-created), merges correctly across two sheets of the
  same detected category into one job, a 429 retried with backoff to
  success.
- **`smoke2.js`** (Test 2 + 4) - category does NOT exist -> `resolveCategory`
  creates it in Xero, `startImport` then imports options under the new
  ID; an archived category is rejected by `resolveCategory` and never
  reaches `startImport`; **uploading the exact same file a second time**
  resolves straight to `FOUND` against the now-existing category (no
  `resolveCategory` call needed) with 0 new options, and creates 0
  duplicate options - asserts exactly one "Class" category exists
  throughout.
- **`smoke3.js`** - OAuth callback stores one shared token across two
  tenants; concurrent `getValidAccessTokenForTenant` calls for both
  tenants near expiry trigger **exactly one** refresh (not two - proves
  the single-flight lock protects Xero's rotating refresh tokens);
  unknown tenant throws `XERO_NOT_CONNECTED`.
- **`smoke4_http.js`** - full HTTP walkthrough through real Express
  routes/middleware: `/auth/xero` redirect -> session cookie -> callback
  with multi-org -> redirects to `/select-organisation` -> `connections`
  lists both orgs -> selecting an org **not** in the list is rejected
  (403, `TENANT_NOT_AUTHORIZED`) -> selecting a real one succeeds ->
  tenant-scoped `tracking-categories` call succeeds -> `logout` ->
  subsequent calls correctly get 401.
- **`smoke5_dotenv_order.js`** - regression test for a real require-order
  bug (fixed): boots the actual server in a fresh child process with
  credentials ONLY in `.env` (never pre-set in the shell), and asserts
  `/auth/xero` redirects correctly - see `docs/API_DECISIONS.md`.
- **`smoke6_autocreate_race_resume.js`** (Test 5, 6, 7) - **two
  simultaneous** `resolveCategory()` calls for the same brand-new category
  name: asserts Xero's `createTrackingCategory` is called **exactly once**
  and both callers resolve to the identical ID (the race-condition
  requirement); a category is created, one option then fails
  **permanently** (400), and `retryFailed()` resumes and reaches SUCCESS
  using the exact same `trackingCategoryId` as the original job; finally,
  Node's require cache is cleared and the service is freshly re-required
  (simulating a server restart, since the category-id cache lives in
  `backend/data/*.json`, not in memory) - resolving the same category name
  again reuses the persisted ID with zero additional `createTrackingCategory`
  calls.
- A 600-option single-sheet file (Test 8, ad hoc) was also run through the
  full `validate -> resolveCategory -> start -> processJob` pipeline with
  the per-tenant rate limit raised via env (to finish in seconds instead
  of the real ~10-minute-at-60/min floor) and completed with all 600
  options created under one auto-created category across 12 batches.
- **`smoke7_live_progress.js`** - regression test for a real bug (fixed):
  polled `getStatus()` (the same call the frontend polls) once every
  ~100ms **while the real, unmocked batch engine was still processing** a
  150-option/3-batch job, and asserted the persisted `successfulOptions`
  counter took on genuine intermediate values (0 -> 50 -> 100 -> 150)
  during `PROCESSING`, not just a jump from 0 straight to 150 at the end.
- **`smoke8_live_progress_http.js`** - the same scenario one layer up,
  through the real Express HTTP routes (session cookie, `requireTenant`
  middleware, actual `GET /status`) - also asserts the response carries
  `Cache-Control: no-store`.
- **`smoke9_error_detail.js`** - regression test for a real bug (fixed):
  the old code read only `response.data.Message`, which for a Xero
  `ValidationException` is always the generic wrapper string
  `"A validation exception occurred"` - the actual field-level reason
  lives one level deeper, in `response.data.Elements[].ValidationErrors[].Message`,
  which was never read. Simulates a real Xero validation error (asserts
  the persisted message is the specific reason, not the generic wrapper,
  and that the option is marked `permanent: true` with exactly 1 attempt -
  never retried) and a gateway-level 500 with a non-JSON HTML body (asserts
  a meaningful message is captured instead of Axios' generic "Request
  failed with status code 500", the option is marked `permanent: false`,
  and it genuinely exhausts `MAX_RETRIES+1` attempts). Also asserts - by
  injecting a fake bearer token into the simulated error's `err.config`
  (exactly where Axios keeps it) and grepping every log line and the full
  error report for it - that the token **never** appears anywhere.
- **`smoke10_429_dashboard_fix.js`** - regression test for a real bug
  (fixed): `listTrackingCategories`/`getTrackingCategory`/
  `createTrackingCategory` had no rate-limit/retry protection at all, so
  while a large import was consuming the tenant's Xero call budget through
  the (correctly) protected option-creation path, an interactive call like
  `GET /api/xero/dashboard` could get a genuine 429 straight from Xero and
  propagate Axios' raw error straight to the frontend. Part A counts
  `createTrackingOption`'s raw attempts directly at the `xeroClient` layer
  to prove it is *not* now double-wrapped (still exactly 1 attempt there;
  its retry still lives only in `trackingBatchService`, unchanged). Part B
  calls the real `GET /api/xero/dashboard` route through the actual HTTP
  server while Xero 429s the first two underlying attempts, and asserts
  the response is a clean `200` - the 429 was absorbed by the same retry
  logic, never reaching the frontend at all. Also asserts no token appears
  in any of the new `[XERO_CALL]` diagnostic log lines.

Run with `node test/<file>.js` from `backend/` (each resets `backend/data/`
first).

Frontend: `npm run build` (Vite/esbuild) passes cleanly - validates every
import resolves and all JSX compiles across every page and component.

**Not yet performed** (needs a real Xero developer account + demo company -
see "Remaining / recommended next steps" below): an actual browser-driven
OAuth login, a real 500/2,000/10,000-row import against live Xero,
killing the server mid-import against a real job, and a real token-expiry
refresh mid-import.

## Remaining / recommended next steps

- **Real-Xero end-to-end pass.** Everything above is verified against a
  faithful stub of Xero's documented API contract, but a real login +
  real 2,000/10,000-option import (and a mid-import server restart)
  against an actual Xero demo company hasn't been run and is the
  highest-value next test.
- **Session store for production.** `express-session`'s default
  `MemoryStore` (used here) is fine for one instance / local dev only -
  swap in `connect-redis` or similar before running more than one server
  process, so a session survives a restart or load-balancer failover.
  (Note this is about the *session* only - Xero tokens are already stored
  durably in `backend/data/`, independent of the session store, and
  already survive a restart.)
- **HTTPS in production.** The session cookie is `secure: false` for local
  HTTP dev; set `NODE_ENV=production` behind HTTPS (see
  `middleware/session.js`) and adjust `sameSite` if the frontend and
  backend end up on different top-level domains.
- **Settings page is intentionally minimal** (connection status + disconnect).
  If you want deeper controls (default batch size, notification
  preferences, etc.), the constants in `config/constants.js` are the ones
  worth exposing there first.
- Optional: a genuinely huge-file (100k+ rows / hundreds of MB) path would
  want `excelParserService.js` swapped to a streaming reader (e.g.
  exceljs) instead of SheetJS's whole-workbook read - noted in that file's
  header comment.

## Security notes

- Xero access/refresh tokens live only in `backend/data/xeroConnections.json`
  (gitignored), addressed by a server-generated `connectionId` - never sent
  to the frontend, never in `localStorage`.
- The session cookie is `httpOnly`, so it isn't reachable from frontend JS.
- `select-connection` verifies the requested `tenantId` is actually part of
  the session's authorized Xero connection before accepting it (403 if not) -
  see `test/smoke4_http.js` step 4.
- Every category a job ever imports into comes from the server's own
  Xero lookup for the current tenant - the client never supplies a raw
  `trackingCategoryId`, only an opaque group `key` (from `/validate`'s own
  response); the backend resolves or creates the actual category itself
  from the file's detected name, and re-verifies it right before creating
  the job. An archived category can never be created over or reused - see
  `test/smoke2.js`'s "resolveCategory on archived rejected" assertion.
- Uploaded files are validated by MIME type and size (`MAX_UPLOAD_BYTES`)
  before parsing.
- Swap `db/store.js`'s file-backed implementation for your production
  datastore (Postgres/Mongo) before deploying multi-instance.
