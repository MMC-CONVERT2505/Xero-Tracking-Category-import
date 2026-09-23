/**
 * Resolves an auto-detected category NAME to a real Xero TrackingCategoryID
 * - reusing it if it already exists, creating it if it doesn't. This is
 * the ONLY place a Tracking Category is ever created.
 *
 * Race-safety: if two imports for the same tenant detect the same category
 * name at the same moment, they must not both create it. Guarded by
 * categoryLockService's generic keyed mutex (also reused for OAuth token
 * refresh elsewhere in this codebase) plus a durable, persisted
 * tenantId::normalizedName -> TrackingCategoryID cache (db/store.js) so a
 * second call - even after a server restart - finds the same ID instead of
 * creating a duplicate (see docs/API_DECISIONS.md, "Category resolution &
 * creation").
 */
const xeroClient = require('./xeroClient');
const store = require('../db/store');
const { withLock } = require('./categoryLockService');
const { normalizeForCompare, normalizeCategoryKey, cleanDisplayValue } = require('../utils/normalize');
const { XERO_ACTIVE_CATEGORY_LIMIT } = require('../config/constants');

/**
 * Returns { trackingCategoryId, categoryName, created }.
 * Throws with `.code`:
 *   CATEGORY_ARCHIVED              - exists but archived, never auto-created/reused
 *   ACTIVE_CATEGORY_LIMIT_REACHED  - doesn't exist and Xero's 2-active-category cap is already hit
 *   (any Xero API error while creating, surfaced as-is)
 */
async function resolveOrCreateCategory(tenantId, rawCategoryName) {
  const categoryName = cleanDisplayValue(rawCategoryName);
  const key = normalizeCategoryKey(tenantId, categoryName);

  return withLock(key, async () => {
    // Durable cache first - lets a second upload of the same file, or a
    // resume after a server restart, find what an earlier call already
    // created without re-hitting Xero's list endpoint every time.
    const cachedId = await store.getCachedCategoryId(key);
    if (cachedId) {
      const cached = await xeroClient.getTrackingCategory(tenantId, cachedId);
      if (cached && cached.Status === 'ACTIVE') {
        return { trackingCategoryId: cachedId, categoryName: cached.Name, created: false };
      }
      // Cache is stale (category was archived/deleted since) - fall through
      // to a full re-resolution below rather than trusting it blindly.
    }

    // Step 2 of the required flow: "search Xero again after acquiring the
    // lock" - this is what actually prevents two concurrent callers from
    // both creating the category (whichever gets the lock second sees the
    // first one's freshly-created category here and reuses it).
    const categories = await xeroClient.listTrackingCategories(tenantId, { includeArchived: true });
    const match = categories.find((c) => normalizeForCompare(c.Name) === normalizeForCompare(categoryName));

    if (match) {
      if (match.Status === 'ARCHIVED') {
        const err = new Error(
          `Tracking Category "${categoryName}" exists in Xero but is ARCHIVED and cannot receive new options.`,
        );
        err.code = 'CATEGORY_ARCHIVED';
        throw err;
      }
      await store.setCachedCategoryId(key, match.TrackingCategoryID);
      return { trackingCategoryId: match.TrackingCategoryID, categoryName: match.Name, created: false };
    }

    const activeCount = categories.filter((c) => c.Status === 'ACTIVE').length;
    if (activeCount >= XERO_ACTIVE_CATEGORY_LIMIT) {
      const err = new Error(
        `Cannot create Tracking Category "${categoryName}": Xero allows a maximum of `
        + `${XERO_ACTIVE_CATEGORY_LIMIT} ACTIVE tracking categories per organisation, `
        + `and ${activeCount} already exist.`,
      );
      err.code = 'ACTIVE_CATEGORY_LIMIT_REACHED';
      throw err;
    }

    let created;
    try {
      created = await xeroClient.createTrackingCategory(tenantId, categoryName);
    } catch (err) {
      const wrapped = new Error(`Unable to create Tracking Category "${categoryName}": ${err.response?.data?.Message || err.message}`);
      wrapped.code = 'CATEGORY_CREATE_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }
    await store.setCachedCategoryId(key, created.TrackingCategoryID);
    return { trackingCategoryId: created.TrackingCategoryID, categoryName: created.Name, created: true };
  });
}

module.exports = { resolveOrCreateCategory };
