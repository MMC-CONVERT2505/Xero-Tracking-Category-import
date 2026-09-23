/**
 * @typedef {Object} ImportBatch
 * @property {string} importId
 * @property {number} batchNumber      1-indexed
 * @property {string[]} optionNames    normalized option names in this batch
 * @property {'PENDING'|'PROCESSING'|'SUCCESS'|'PARTIAL'|'FAILED'|'CANCELLED'} status
 * @property {number} attempts
 * @property {number} successCount
 * @property {number} failedCount
 *
 * A "batch" is a bookkeeping grouping for progress/resume purposes only -
 * see docs/API_DECISIONS.md for why Xero's Options endpoint means each
 * option inside a batch is still its own HTTP request.
 */
module.exports = {};
