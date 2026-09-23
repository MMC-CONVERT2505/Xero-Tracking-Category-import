/**
 * Retry wrapper implementing:
 *  - retry only for transient errors (429/408/500/502/503/504, network resets/timeouts)
 *  - permanent failures (400/401/403/404, invalid TrackingCategoryID, validation
 *    errors) fail immediately, no retry
 *  - exponential backoff with jitter, capped at MAX_BACKOFF_MS
 *  - honours Retry-After on 429 responses instead of guessing
 */
const {
  MAX_RETRIES,
  RETRYABLE_STATUS_CODES,
  RETRYABLE_ERROR_CODES,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
} = require('../config/constants');

function isRetryable(err) {
  const status = err?.response?.status;
  if (status && RETRYABLE_STATUS_CODES.includes(status)) return true;
  if (err?.code && RETRYABLE_ERROR_CODES.includes(err.code)) return true;
  return false;
}

function retryAfterMs(err) {
  const header = err?.response?.headers?.['retry-after'];
  if (!header) return null;
  // Retry-After can be seconds, or (rarely) an HTTP date
  const asSeconds = Number(header);
  if (!Number.isNaN(asSeconds)) return asSeconds * 1000;
  const asDate = new Date(header).getTime();
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function backoffMs(attempt) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  const jitter = Math.random() * exp * 0.2;
  return exp + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` (a zero-arg async function) with retry.
 * `onAttempt(attempt, err|null)` is called for observability/logging.
 * Throws the last error, tagged `.permanent = true/false`, if all retries are exhausted.
 */
async function withRetry(fn, { maxRetries = MAX_RETRIES, onAttempt } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      const result = await fn();
      if (onAttempt) onAttempt(attempt, null);
      return result;
    } catch (err) {
      lastErr = err;
      if (onAttempt) onAttempt(attempt, err);

      if (!isRetryable(err)) {
        err.permanent = true;
        throw err;
      }
      if (attempt > maxRetries) {
        err.permanent = false;
        err.retriesExhausted = true;
        throw err;
      }
      const status = err?.response?.status;
      const wait = status === 429 ? (retryAfterMs(err) ?? backoffMs(attempt)) : backoffMs(attempt);
      await sleep(wait);
    }
  }
  throw lastErr;
}

module.exports = { withRetry, isRetryable };
