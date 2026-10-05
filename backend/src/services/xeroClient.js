/**
 * Thin, low-level Xero Accounting API wrapper.
 *
 * IMPORTANT (see docs/API_DECISIONS.md, "Diagnosing the dashboard 429"):
 * `createTrackingOption` is the ONLY function here whose calls are rate
 * limited and retried - and that protection lives OUTSIDE this file, in
 * trackingBatchService.attemptOption (rateLimiter.acquire + retryService.
 * withRetry wrapped around it there). The other three functions
 * (listTrackingCategories, getTrackingCategory, createTrackingCategory)
 * used to have NO rate-limit or retry protection at all when called from
 * interactive requests (dashboard, tracking-categories list, category
 * resolution) - while a large import is consuming most of the tenant's
 * Xero call budget through the properly-protected option-creation path,
 * one of these unprotected calls could get a real 429 straight from Xero
 * and propagate Axios' raw error straight to the frontend. They now share
 * the SAME rateLimiter/retryService (imported, not modified) as the
 * option-creation path, via callProtected() below. createTrackingOption's
 * own call is untouched - it is still wrapped only externally, exactly as
 * before, so the already-tested import engine behaves identically.
 */
const axios = require('axios');
const crypto = require('crypto');
const { getValidAccessTokenForTenant } = require('./xeroConnectionService');
const rateLimiter = require('./rateLimiter');
const retryService = require('./retryService');
const { parseXeroError } = require('../utils/xeroErrorParser');
const { getRequestContext } = require('../middleware/requestContext');

const BASE_URL = 'https://api.xero.com/api.xro/2.0';

async function authHeaders(tenantId, extra = {}) {
  // Resolves (and transparently refreshes) a token scoped to THIS tenantId -
  // works identically whether called from an interactive request or a
  // background batch job with no browser session attached (section 13).
  const token = await getValidAccessTokenForTenant(tenantId);
  return {
    Authorization: `Bearer ${token}`,
    'xero-tenant-id': tenantId,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra,
  };
}

// ---------------------------------------------------------------------
// TEMPORARY diagnostic logging (see the two GitHub-issue-style tasks in
// docs/API_DECISIONS.md this was added for). Purely observational: every
// wrapper here calls the real function and returns/throws exactly what it
// returned/threw - nothing about a call's outcome is ever changed by
// logging it. Safe to delete this whole block (and its two call sites
// below) once the investigation is done; nothing else depends on it.
// ---------------------------------------------------------------------
function logXeroCall(routeName, method, urlPath, outcome) {
  const ctx = getRequestContext();
  // eslint-disable-next-line no-console
  console.log('[XERO_CALL]', JSON.stringify({
    calledFrom: ctx ? `${ctx.method} ${ctx.path}` : 'background-import',
    xeroFunction: routeName,
    method,
    urlPath,
    ...outcome,
  }));
}

/** Runs `fn` (an axios call), logging outcome + Xero's own response headers either way. Never alters the result. */
async function withDiagnostics(routeName, method, urlPath, fn) {
  try {
    const res = await fn();
    logXeroCall(routeName, method, urlPath, {
      calledXero: true,
      status: res.status,
      xeroRateLimitHeaders: {
        'x-minlimit-remaining': res.headers?.['x-minlimit-remaining'],
        'x-daylimit-remaining': res.headers?.['x-daylimit-remaining'],
        'x-appminlimit-remaining': res.headers?.['x-appminlimit-remaining'],
      },
    });
    return res;
  } catch (err) {
    const parsed = parseXeroError(err);
    logXeroCall(routeName, method, urlPath, {
      calledXero: true,
      status: parsed.httpStatus,
      hasResponse: parsed.hasResponse,
      bodyEmpty: parsed.bodyEmpty,
      networkErrorCode: parsed.networkErrorCode,
      retryAfter: parsed.retryAfter,
      xeroRateLimitHeaders: parsed.safeResponseHeaders,
      xeroErrorMessage: parsed.xeroMessage,
    });
    throw err;
  }
}
// --------------------------- end diagnostic block ---------------------

/**
 * Rate-limits + retries an interactive (non-option-creation) Xero call
 * using the SAME, unmodified rateLimiter/retryService the import engine
 * already relies on for options - just applied here too, so these calls
 * stop competing unprotected for the same per-tenant Xero budget. Not
 * used for createTrackingOption (see module header comment).
 */
async function callProtected(tenantId, fn) {
  return retryService.withRetry(async () => {
    await rateLimiter.acquire(tenantId);
    return fn();
  });
}

/** GET /TrackingCategories - optionally including archived categories. */
async function listTrackingCategories(tenantId, { includeArchived = true } = {}) {
  const headers = await authHeaders(tenantId);
  const res = await callProtected(tenantId, () => withDiagnostics(
    'listTrackingCategories', 'GET', '/TrackingCategories',
    () => axios.get(`${BASE_URL}/TrackingCategories`, { headers, params: includeArchived ? { includeArchived: true } : {} }),
  ));
  return res.data.TrackingCategories || [];
}

/** GET single tracking category (includes its current Options array). */
async function getTrackingCategory(tenantId, trackingCategoryId) {
  const headers = await authHeaders(tenantId);
  const res = await callProtected(tenantId, () => withDiagnostics(
    'getTrackingCategory', 'GET', `/TrackingCategories/${trackingCategoryId}`,
    () => axios.get(`${BASE_URL}/TrackingCategories/${trackingCategoryId}`, { headers }),
  ));
  const [category] = res.data.TrackingCategories || [];
  return category || null;
}

/** PUT /TrackingCategories - creates a brand new tracking category. */
async function createTrackingCategory(tenantId, name) {
  const headers = await authHeaders(tenantId, { 'Idempotency-Key': crypto.randomUUID() });
  const res = await callProtected(tenantId, () => withDiagnostics(
    'createTrackingCategory', 'PUT', '/TrackingCategories',
    () => axios.put(`${BASE_URL}/TrackingCategories`, { Name: name }, { headers }),
  ));
  const [category] = res.data.TrackingCategories || [];
  return category;
}

/**
 * PUT /TrackingCategories/{id}/Options
 * Xero's Options endpoint accepts exactly ONE option object per request
 * (confirmed against the current API contract). Do NOT send an array here.
 * `idempotencyKey` should be a stable, deterministic value derived from
 * (importId + normalized option name) so a retried/duplicated call never
 * creates the same option twice - see trackingOptionService.js.
 *
 * UNCHANGED from before this file's diagnostic-logging pass: still no
 * rate-limit/retry wrapping in here - that happens exactly once, in
 * trackingBatchService.attemptOption, same as always. Only the (purely
 * observational) diagnostic logging is new.
 */
async function createTrackingOption(tenantId, trackingCategoryId, name, idempotencyKey) {
  const headers = await authHeaders(tenantId, { 'Idempotency-Key': idempotencyKey });
  const res = await withDiagnostics(
    'createTrackingOption', 'PUT', `/TrackingCategories/${trackingCategoryId}/Options`,
    () => axios.put(`${BASE_URL}/TrackingCategories/${trackingCategoryId}/Options`, { Name: name }, { headers }),
  );
  return res.data;
}

module.exports = {
  listTrackingCategories,
  getTrackingCategory,
  createTrackingCategory,
  createTrackingOption,
};
