/**
 * In-process mutex keyed by `tenantId::normalizedCategoryName`.
 *
 * Prevents the classic race:
 *   Import A: "Department" not found -> starts creating it
 *   Import B: "Department" not found -> also starts creating it
 *   -> two "Department" categories in Xero
 *
 * NOTE: this only protects a single Node process. If you run this service
 * with multiple instances/replicas behind a load balancer, replace this
 * with a distributed lock (Redis SETNX / Redlock) using the same key
 * scheme - the calling code does not need to change.
 */

const locks = new Map(); // key -> Promise chain (tail of the queue)

async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, prev.then(() => current));

  await prev; // wait for our turn
  try {
    return await fn();
  } finally {
    release();
    // Clean up the map once nobody else is queued behind us.
    if (locks.get(key) === current) locks.delete(key);
  }
}

module.exports = { withLock };
