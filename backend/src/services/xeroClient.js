/**
 * Thin, low-level Xero Accounting API wrapper. Every call goes through
 * rateLimiter + queueService (in the calling services) - this module only
 * knows how to make one correctly-shaped HTTP call at a time.
 *
 * Payload shapes below were verified against Xero's current published API
 * contract for the Tracking Categories endpoints - see docs/API_DECISIONS.md.
 */
const axios = require('axios');
const crypto = require('crypto');
const { getValidAccessTokenForTenant } = require('./xeroConnectionService');

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

/** GET /TrackingCategories - optionally including archived categories. */
async function listTrackingCategories(tenantId, { includeArchived = true } = {}) {
  const headers = await authHeaders(tenantId);
  const res = await axios.get(`${BASE_URL}/TrackingCategories`, {
    headers,
    params: includeArchived ? { includeArchived: true } : {},
  });
  return res.data.TrackingCategories || [];
}

/** GET single tracking category (includes its current Options array). */
async function getTrackingCategory(tenantId, trackingCategoryId) {
  const headers = await authHeaders(tenantId);
  const res = await axios.get(`${BASE_URL}/TrackingCategories/${trackingCategoryId}`, { headers });
  const [category] = res.data.TrackingCategories || [];
  return category || null;
}

/** PUT /TrackingCategories - creates a brand new tracking category. */
async function createTrackingCategory(tenantId, name) {
  const headers = await authHeaders(tenantId, { 'Idempotency-Key': crypto.randomUUID() });
  const res = await axios.put(`${BASE_URL}/TrackingCategories`, { Name: name }, { headers });
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
 */
async function createTrackingOption(tenantId, trackingCategoryId, name, idempotencyKey) {
  const headers = await authHeaders(tenantId, { 'Idempotency-Key': idempotencyKey });
  const res = await axios.put(
    `${BASE_URL}/TrackingCategories/${trackingCategoryId}/Options`,
    { Name: name },
    { headers },
  );
  return res.data;
}

module.exports = {
  listTrackingCategories,
  getTrackingCategory,
  createTrackingCategory,
  createTrackingOption,
};
