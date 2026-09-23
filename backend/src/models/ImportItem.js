/**
 * @typedef {Object} ImportItem  (called "OptionResult" in db/store.js)
 * @property {string} displayName        exact value sent to Xero
 * @property {'PENDING'|'SUCCESS'|'FAILED'} status
 * @property {number} attempts
 * @property {number} batchNumber
 * @property {boolean} [permanent]        true if a non-retryable error (400/401/403/404)
 * @property {number} [httpStatus]
 * @property {string} [xeroError]
 * @property {string} [trackingOptionId]  set once SUCCESS
 * @property {string} [updatedAt]
 *
 * Keyed by normalized option name within an importId - see
 * db/store.js saveOptionResult/getOptionResults. This is the unit that
 * idempotency (importId + normalizedName) and Retry Failed both operate on.
 */
module.exports = {};
