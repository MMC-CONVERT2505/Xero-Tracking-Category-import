/**
 * Central configuration for the Tracking Options import engine.
 * Every tunable lives here so behaviour can be changed without touching
 * business logic.
 */
require('dotenv').config();
const path = require('path');

module.exports = {
  // ---- Xero API limits (see docs/API_DECISIONS.md for how these were verified) ----
  XERO_ACTIVE_CATEGORY_LIMIT: 2,        // Xero allows max 2 ACTIVE tracking categories per org
  XERO_SOFT_OPTION_LIMIT: 100,          // recommended (NOT enforced) options per category
  XERO_MAX_CONCURRENT_REQUESTS: Number(process.env.XERO_MAX_CONCURRENT_REQUESTS || 5),
  XERO_MAX_REQUESTS_PER_MINUTE: Number(process.env.XERO_MAX_REQUESTS_PER_MINUTE || 60),

  // ---- Batching ----
  // IMPORTANT: PUT /TrackingCategories/{id}/Options only accepts ONE option
  // object per request (verified against Xero's current API contract - see
  // docs/API_DECISIONS.md). "Batch" here means a logical group of options
  // used for progress/resume bookkeeping, NOT a single bulk HTTP request.
  // Every option inside a batch is still sent as its own rate-limited call.
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 50),

  // ---- Retry policy ----
  MAX_RETRIES: Number(process.env.MAX_RETRIES || 5),
  RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504],
  RETRYABLE_ERROR_CODES: ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'],
  BASE_BACKOFF_MS: 1000,
  MAX_BACKOFF_MS: 60_000,

  // ---- Storage ----
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'),

  // ---- Uploads ----
  ALLOWED_UPLOAD_MIME: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel', // xls
    'text/csv',
    'application/csv',
  ],
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024), // 50MB

  PORT: Number(process.env.PORT || 4000),
};
