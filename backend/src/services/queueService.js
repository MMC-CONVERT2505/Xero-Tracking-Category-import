/**
 * Per-tenant concurrency-controlled queue.
 *
 * This is the piece that stops "10,000 options" from ever becoming
 * "10,000 simultaneous HTTP requests" (or even Promise.all(1000)).
 * At most XERO_MAX_CONCURRENT_REQUESTS tasks run at once per tenant;
 * everything else waits in line.
 *
 * Intentionally dependency-free (no p-queue/bullmq) so the whole engine
 * has zero native deps and is trivial to read/audit. The comment on
 * PROGRESS.md / README explains how to swap this for BullMQ+Redis if the
 * import needs to survive a full process restart mid *batch* (this
 * implementation already survives restart at the *batch* granularity via
 * the persisted job/batch store - see trackingImportService.resumeImport).
 */
const { XERO_MAX_CONCURRENT_REQUESTS } = require('../config/constants');

class TenantQueue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.active = 0;
    this.pending = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const { task, resolve, reject } = this.pending.shift();
      this.active += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.active -= 1;
          this._drain();
        });
    }
  }
}

const queuesByTenant = new Map();

function getQueue(tenantId) {
  if (!queuesByTenant.has(tenantId)) {
    queuesByTenant.set(tenantId, new TenantQueue(XERO_MAX_CONCURRENT_REQUESTS));
  }
  return queuesByTenant.get(tenantId);
}

/** Schedule `task` on the tenant's queue; resolves/rejects with the task's outcome. */
function enqueue(tenantId, task) {
  return getQueue(tenantId).run(task);
}

module.exports = { enqueue };
