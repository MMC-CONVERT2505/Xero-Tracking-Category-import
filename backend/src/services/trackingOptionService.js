/**
 * Existing-option lookups + single-option creation, with idempotency.
 */
const crypto = require('crypto');
const xeroClient = require('./xeroClient');
const { normalizeForCompare } = require('../utils/normalize');

/**
 * Returns a Map<normalizedName, { name, status, trackingOptionId }> of every
 * option currently on the category (active AND archived - callers decide
 * how to treat each, per section 8 of the spec).
 */
async function fetchExistingOptions(tenantId, trackingCategoryId) {
  const category = await xeroClient.getTrackingCategory(tenantId, trackingCategoryId);
  const options = category?.Options || [];
  const map = new Map();
  for (const opt of options) {
    map.set(normalizeForCompare(opt.Name), {
      name: opt.Name,
      status: opt.Status,
      trackingOptionId: opt.TrackingOptionID,
    });
  }
  return map;
}

/** Deterministic idempotency key so retries/duplicate uploads never double-create. */
function buildIdempotencyKey(importId, normalizedOptionName) {
  return crypto
    .createHash('sha256')
    .update(`${importId}::${normalizedOptionName}`)
    .digest('hex')
    .slice(0, 64);
}

async function createOption(tenantId, trackingCategoryId, displayName, importId, normalizedName) {
  const idempotencyKey = buildIdempotencyKey(importId, normalizedName);
  return xeroClient.createTrackingOption(tenantId, trackingCategoryId, displayName, idempotencyKey);
}

module.exports = { fetchExistingOptions, createOption, buildIdempotencyKey };
