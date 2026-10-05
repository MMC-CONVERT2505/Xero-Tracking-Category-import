/**
 * TEMPORARY diagnostic infrastructure for tracing "which endpoint called
 * Xero" (see docs/API_DECISIONS.md, "Diagnosing the dashboard 429").
 *
 * Carries { method, path } from the Express request that's currently being
 * handled down into xeroClient.js's diagnostic logging, via
 * AsyncLocalStorage, so a Xero-call log line can say exactly which of our
 * own routes triggered it - "GET /api/xero/dashboard" vs a background
 * import job with no active request at all. Purely observational: this
 * never changes request handling, routing, or response behavior.
 */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function requestContextMiddleware(req, res, next) {
  als.run({ method: req.method, path: req.originalUrl }, next);
}

/** Returns the current request's { method, path }, or null if called from
 * outside any request (e.g. the background import's batch processor). */
function getRequestContext() {
  return als.getStore() || null;
}

module.exports = { requestContextMiddleware, getRequestContext };
