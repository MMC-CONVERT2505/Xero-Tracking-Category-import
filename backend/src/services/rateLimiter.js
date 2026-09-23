/**
 * Token-bucket rate limiter: caps requests to XERO_MAX_REQUESTS_PER_MINUTE
 * per tenant. Combined with queueService's concurrency cap, this keeps the
 * tool inside Xero's "5 concurrent / 60 per minute per tenant" limits.
 *
 * One bucket per tenantId so multiple tenants don't starve each other.
 */
const { XERO_MAX_REQUESTS_PER_MINUTE } = require('../config/constants');

class TokenBucket {
  constructor(capacity, refillIntervalMs) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillIntervalMs = refillIntervalMs;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const refillRate = this.capacity / this.refillIntervalMs; // tokens per ms
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * refillRate);
    this.lastRefill = now;
  }

  /** Resolves once a token is available, then consumes it. */
  async take() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this._refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const msPerToken = this.refillIntervalMs / this.capacity;
      await new Promise((r) => setTimeout(r, Math.max(10, msPerToken)));
    }
  }
}

const bucketsByTenant = new Map();

function getBucket(tenantId) {
  if (!bucketsByTenant.has(tenantId)) {
    bucketsByTenant.set(tenantId, new TokenBucket(XERO_MAX_REQUESTS_PER_MINUTE, 60_000));
  }
  return bucketsByTenant.get(tenantId);
}

async function acquire(tenantId) {
  await getBucket(tenantId).take();
}

module.exports = { acquire };
