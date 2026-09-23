/**
 * The actual processing engine: turns a persisted ImportJob + its Batches
 * into controlled, rate-limited, retried Xero API calls - and can be
 * called again at any time (server restart, explicit /resume, explicit
 * /retry-failed) without redoing work that already succeeded.
 */
const store = require('../db/store');
const queueService = require('./queueService');
const rateLimiter = require('./rateLimiter');
const retryService = require('./retryService');
const trackingOptionService = require('./trackingOptionService');
const { normalizeForCompare } = require('../utils/normalize');
const { parseXeroError } = require('../utils/xeroErrorParser');

function log(importId, msg) {
  // eslint-disable-next-line no-console
  console.log(`[IMPORT] ${importId} ${msg}`);
}

async function recomputeJobCounters(importId) {
  const results = await store.getOptionResults(importId);
  const values = Object.values(results);
  const successfulOptions = values.filter((r) => r.status === 'SUCCESS').length;
  const failedOptions = values.filter((r) => r.status === 'FAILED').length;
  const pendingOptions = values.filter((r) => r.status === 'PENDING').length;
  await store.patchJob(importId, { successfulOptions, failedOptions, pendingOptions });
  return { successfulOptions, failedOptions, pendingOptions };
}

/**
 * Processes every batch of a job that isn't already fully SUCCESS.
 * Safe to call repeatedly (resume / retry-failed / crash recovery all
 * funnel through here) - already-SUCCESS options are skipped.
 *
 * `optionFilter(result)` lets callers narrow which options get
 * (re)attempted, e.g. retryFailed() only re-queues FAILED, non-permanent
 * options.
 */
async function processJob(importId, { optionFilter } = {}) {
  const job = await store.getJob(importId);
  if (!job) throw new Error(`Import job ${importId} not found`);
  if (job.status === 'CANCELLED') return job;

  await store.patchJob(importId, { status: 'PROCESSING' });
  log(importId, 'processing started');

  // If this is a resume (after a crash, or an explicit /resume or
  // /retry-failed call), the job record's cached counters may be stale
  // relative to option results already persisted from a previous run -
  // sync them immediately so a poll right after resuming shows reality
  // straight away, without waiting for the next batch to complete.
  await recomputeJobCounters(importId);

  const batches = await store.getBatches(importId);
  const defaultFilter = (r) => r.status === 'PENDING' || (r.status === 'FAILED' && !r.permanent);
  const shouldProcess = optionFilter || defaultFilter;

  for (const batch of batches) {
    const freshJob = await store.getJob(importId);
    if (freshJob.cancelRequested) {
      await store.patchBatch(importId, batch.batchNumber, { status: 'CANCELLED' });
      continue;
    }

    const results = await store.getOptionResults(importId);
    const toRun = batch.optionNames
      .map((normalizedName) => results[normalizedName])
      .filter((r) => r && shouldProcess(r));

    if (toRun.length === 0) {
      // Nothing left to do in this batch - make sure its status reflects reality.
      const allInBatch = batch.optionNames.map((n) => results[n]).filter(Boolean);
      const allSuccess = allInBatch.every((r) => r.status === 'SUCCESS');
      await store.patchBatch(importId, batch.batchNumber, {
        status: allSuccess ? 'SUCCESS' : (batch.status === 'PENDING' ? 'PENDING' : batch.status),
      });
      continue;
    }

    await store.patchBatch(importId, batch.batchNumber, { status: 'PROCESSING' });
    log(importId, `batch ${batch.batchNumber} processing (${toRun.length} options)`);

    // eslint-disable-next-line no-await-in-loop
    const settled = await Promise.allSettled(
      toRun.map((optionResult) => queueService.enqueue(job.tenantId, () => attemptOption(job, optionResult))),
    );

    const successCount = settled.filter((s) => s.status === 'fulfilled').length;
    const failedCount = settled.length - successCount;
    const batchStatus = failedCount === 0 ? 'SUCCESS' : (successCount === 0 ? 'FAILED' : 'PARTIAL');
    // eslint-disable-next-line no-await-in-loop
    await store.patchBatch(importId, batch.batchNumber, {
      status: batchStatus,
      successCount: (batch.successCount || 0) + successCount,
      failedCount: (batch.failedCount || 0) + failedCount,
      attempts: (batch.attempts || 0) + 1,
    });
    // Sync the job-level counters the frontend polls (successfulOptions/
    // failedOptions/pendingOptions) RIGHT AFTER this batch, not only once
    // at the very end of the whole job. This is the one and only change
    // needed to fix the live-progress issue - everything else in this
    // loop (queueing, retry, rate limiting) is untouched.
    // eslint-disable-next-line no-await-in-loop
    await recomputeJobCounters(importId);
    log(importId, `batch ${batch.batchNumber} done: ${successCount} ok, ${failedCount} failed`);
  }

  const counters = await recomputeJobCounters(importId);
  const finalStatus = (await store.getJob(importId)).cancelRequested
    ? 'CANCELLED'
    : counters.pendingOptions > 0
      ? 'PARTIAL' // shouldn't normally happen (loop above drains pending), kept as a safety net
      : counters.failedOptions === 0
        ? 'SUCCESS'
        : counters.successfulOptions === 0
          ? 'FAILED'
          : 'PARTIAL';

  await store.patchJob(importId, { status: finalStatus });
  log(importId, `processing finished: ${finalStatus}`);
  return store.getJob(importId);
}

/** Executes exactly one option creation, with rate limiting + retry, and persists the outcome. */
async function attemptOption(job, optionResult) {
  const normalizedName = normalizeForCompare(optionResult.displayName);
  let attempts = 0;

  try {
    const data = await retryService.withRetry(
      async () => {
        attempts += 1;
        await rateLimiter.acquire(job.tenantId);
        return trackingOptionService.createOption(
          job.tenantId,
          job.trackingCategoryId,
          optionResult.displayName,
          job.importId,
          normalizedName,
        );
      },
      {
        onAttempt: (attempt, err) => {
          if (err) {
            const status = err?.response?.status;
            log(job.importId, `option "${optionResult.displayName}" attempt ${attempt} failed`
              + `${status ? ` (HTTP ${status})` : ''}${status === 429 ? ' -> rate limited, backing off' : ''}`);
          }
        },
      },
    );

    const created = (data?.Options || [])[0];
    await store.saveOptionResult(job.importId, normalizedName, {
      ...optionResult,
      status: 'SUCCESS',
      attempts,
      trackingOptionId: created?.TrackingOptionID || null,
      httpStatus: 200,
      xeroError: null,
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    const parsed = parseXeroError(err);

    // Task 5: structured, token-free logging for every failed option -
    // built only from parsed.* (httpStatus/messages/snippet), never from
    // err.config (which is where the Authorization header lives), so a
    // token can never end up in this log line even by accident.
    // eslint-disable-next-line no-console
    console.error('[IMPORT_ERROR]', JSON.stringify({
      optionName: optionResult.displayName,
      batchNumber: optionResult.batchNumber,
      trackingCategoryId: job.trackingCategoryId,
      status: parsed.httpStatus,
      retryable: !err.permanent,
      xeroErrorMessage: parsed.xeroMessage,
      xeroErrorDetails: parsed.xeroValidationMessages.length ? parsed.xeroValidationMessages : parsed.rawBodySnippet,
      attempt: attempts,
    }));

    await store.saveOptionResult(job.importId, normalizedName, {
      ...optionResult,
      status: 'FAILED',
      attempts,
      permanent: !!err.permanent,
      httpStatus: parsed.httpStatus,
      // `xeroError` keeps its existing name/shape (a single display
      // string) so the already-working error report / CSV export need no
      // changes - it just now carries the REAL Xero message instead of
      // Axios' generic one. The richer fields below are additive.
      xeroError: parsed.friendlyMessage,
      xeroErrorType: parsed.xeroErrorType,
      xeroErrorNumber: parsed.xeroErrorNumber,
      xeroValidationMessages: parsed.xeroValidationMessages,
      retryAfter: parsed.retryAfter,
      updatedAt: new Date().toISOString(),
    });
    throw err;
  }
}

module.exports = { processJob, recomputeJobCounters };
