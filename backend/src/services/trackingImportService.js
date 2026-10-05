/**
 * Top-level orchestration for the AUTO-DETECTED category flow. The user
 * uploads a file, and the Tracking Category is resolved automatically from
 * each sheet's first-column header - never typed or picked from a
 * dropdown. See excelParserService.parseAutoDetectCategories for the file
 * format.
 *
 * A detected category that already exists in Xero is reused as-is. A
 * detected category that does NOT exist is automatically CREATED (see
 * trackingCategoryService.resolveOrCreateCategory) once the user confirms
 * via resolveCategory() - this is the "Continue Import" step on the
 * preflight screen. A category that exists but is ARCHIVED is never
 * auto-created or reused; it's always blocked with a clear error.
 *
 * One upload can produce MULTIPLE import jobs (one per detected category) -
 * startImport returns an array, not a single job.
 *
 * Batch processing itself (queueing, rate limiting, retry, resume,
 * idempotency) is UNCHANGED from the original engine - see
 * trackingBatchService.js - this file only changed what happens before a
 * job is created.
 */
const crypto = require('crypto');
const store = require('../db/store');
const excelParserService = require('./excelParserService');
const xeroClient = require('./xeroClient');
const trackingCategoryService = require('./trackingCategoryService');
const trackingOptionService = require('./trackingOptionService');
const trackingBatchService = require('./trackingBatchService');
const { normalizeForCompare, cleanDisplayValue, findClosestActiveCategory } = require('../utils/normalize');
const { BATCH_SIZE, XERO_SOFT_OPTION_LIMIT, XERO_ACTIVE_CATEGORY_LIMIT } = require('../config/constants');

// Short-lived handoff between /validate, /resolve-category and /start - does
// not need to survive a restart (unlike ImportJob/Batches, and unlike the
// TrackingCategoryID cache in db/store.js, which does). If the server
// restarts mid-preflight, the user just re-uploads.
const pendingUploads = new Map(); // uploadToken -> { tenantId, fileName, groups: [...] }

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dedupe(records) {
  const seen = new Set();
  const uniqueOptions = [];
  let duplicateRows = 0;
  for (const rec of records) {
    const display = cleanDisplayValue(rec.optionName);
    const key = normalizeForCompare(display);
    if (seen.has(key)) { duplicateRows += 1; continue; }
    seen.add(key);
    uniqueOptions.push(display);
  }
  return { uniqueOptions, duplicateRows };
}

/** Computes the FOUND-state fields (existing/new diff) once a group has a real, ACTIVE trackingCategoryId. */
async function diffAgainstXero(tenantId, trackingCategoryId, uniqueOptions) {
  const existingMap = await trackingOptionService.fetchExistingOptions(tenantId, trackingCategoryId);
  const existingActive = [...existingMap.values()].filter((o) => o.status === 'ACTIVE');
  const archivedConflicts = uniqueOptions.filter((name) => {
    const existing = existingMap.get(normalizeForCompare(name));
    return existing && existing.status !== 'ACTIVE';
  });
  const newOptions = uniqueOptions.filter((name) => !existingMap.has(normalizeForCompare(name)));
  return {
    existingOptionsCount: existingActive.length,
    newOptionsCount: newOptions.length,
    estimatedApiOperations: newOptions.length,
    archivedConflicts,
    softLimitWarning: existingActive.length + newOptions.length > XERO_SOFT_OPTION_LIMIT,
  };
}

/**
 * Classifies one detected-category group against the tenant's REAL Xero
 * categories (fetched once, passed in) - read-only, never creates
 * anything. NOT_FOUND and POSSIBLE_MISMATCH groups are resolved (and, if
 * needed, created) later via resolveCategory(), only once the user has
 * seen and explicitly confirmed them - this function never picks a side.
 */
async function classifyGroup(tenantId, group, xeroCategories) {
  const { uniqueOptions, duplicateRows } = dedupe(group.records);
  const exactMatch = xeroCategories.find(
    (c) => normalizeForCompare(c.Name) === normalizeForCompare(group.categoryNameInFile),
  );

  const base = {
    key: group.key,
    categoryNameInFile: group.categoryNameInFile,
    sheetsInvolved: [...new Set(group.records.map((r) => r.sheetName))],
    excelOptionsTotal: group.records.length,
    uniqueOptionsCount: uniqueOptions.length,
    duplicateRows,
    uniqueOptions, // kept server-side only, stripped before any response reaches the client
  };

  if (!exactMatch) {
    // A conservative Levenshtein-distance check for a likely typo against
    // an existing ACTIVE category (e.g. "Clas" -> "Class"). This NEVER
    // auto-picks anything - it only changes whether the user sees a plain
    // "not found, will create" card or a "possible mismatch, please
    // choose" one. See docs/API_DECISIONS.md, "Category typo/mismatch
    // confirmation".
    const suggestion = findClosestActiveCategory(group.categoryNameInFile, xeroCategories);
    const activeCategoryCount = xeroCategories.filter((c) => c.Status === 'ACTIVE').length;
    // Creating a brand-new category (whether via plain auto-create, or via
    // "Create new" on a mismatch prompt) would violate Xero's real
    // 2-active-category cap - surfaced up front here so the UI can grey
    // out that option with a clear reason instead of only failing after
    // the user clicks it (trackingCategoryService still enforces this
    // itself regardless - this is purely a better-informed UI).
    const categoryLimitReached = activeCategoryCount >= XERO_ACTIVE_CATEGORY_LIMIT;

    return {
      ...base,
      status: suggestion ? 'POSSIBLE_MISMATCH' : 'NOT_FOUND',
      suggestion: suggestion ? { trackingCategoryId: suggestion.TrackingCategoryID, name: suggestion.Name } : null,
      categoryLimitReached,
      activeCategoryCount,
    };
  }
  if (exactMatch.Status !== 'ACTIVE') {
    return {
      ...base,
      status: 'ARCHIVED',
      error: `"${exactMatch.Name}" exists in Xero but is ${exactMatch.Status} and cannot receive new options.`,
      trackingCategoryId: exactMatch.TrackingCategoryID,
    };
  }

  const diff = await diffAgainstXero(tenantId, exactMatch.TrackingCategoryID, uniqueOptions);
  return {
    ...base,
    status: 'FOUND',
    trackingCategoryId: exactMatch.TrackingCategoryID,
    categoryName: exactMatch.Name,
    ...diff,
  };
}

function toClientShape(group) {
  const { uniqueOptions, ...rest } = group;
  return rest;
}

async function validateUpload(tenantId, fileBuffer, fileName) {
  const { groups, errors: rowErrors, sheetsProcessed } = excelParserService.parseAutoDetectCategories(fileBuffer);

  if (groups.length === 0) {
    const err = new Error('No Tracking Category could be detected in this file. The first column of each sheet must have a header naming the category (e.g. "Class").');
    err.code = 'NO_CATEGORY_DETECTED';
    err.status = 400;
    throw err;
  }

  const xeroCategories = await xeroClient.listTrackingCategories(tenantId, { includeArchived: true });
  const resolved = await Promise.all(groups.map((g) => classifyGroup(tenantId, g, xeroCategories)));

  const uploadToken = crypto.randomUUID();
  pendingUploads.set(uploadToken, { tenantId, fileName, groups: resolved, createdAt: Date.now() });

  return {
    uploadToken,
    fileName,
    sheetsProcessed,
    sheetsCount: sheetsProcessed.length,
    rowErrors,
    categories: resolved.map(toClientShape),
  };
}

/**
 * The confirmation step for one unresolved category:
 *   - NOT_FOUND (no similar existing category): "Continue Import" -
 *     `decision` is not required, behaves exactly as before (auto-creates,
 *     or reuses if a concurrent request just created it - see
 *     trackingCategoryService's locking).
 *   - POSSIBLE_MISMATCH (a likely-typo match against an existing ACTIVE
 *     category): the user MUST explicitly pass `decision`, either
 *     'use_existing' (reuse the suggested category - never creates
 *     anything) or 'create_new' (create the name exactly as uploaded,
 *     blocked if that would exceed Xero's active-category limit). No
 *     default/silent choice exists - an unresolved mismatch simply cannot
 *     proceed to startImport (see there: anything not status FOUND is
 *     skipped, not silently resolved).
 *
 * Mutates the group in-place within pendingUploads so a subsequent
 * startImport() picks it up. Safe to call more than once for the same
 * group (idempotent - a second call with the same decision just finds
 * what the first one already resolved).
 */
async function resolveCategory(tenantId, uploadToken, key, decision) {
  const pending = pendingUploads.get(uploadToken);
  if (!pending || pending.tenantId !== tenantId) {
    const err = new Error('Upload session expired or not found. Please re-upload the file.');
    err.code = 'UPLOAD_TOKEN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const index = pending.groups.findIndex((g) => g.key === key);
  if (index === -1) {
    const err = new Error('That category was not part of the uploaded file.');
    err.code = 'GROUP_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const group = pending.groups[index];
  if (group.status === 'FOUND') return toClientShape(group); // idempotent no-op
  if (group.status === 'ARCHIVED') {
    const err = new Error(group.error);
    err.code = 'CATEGORY_ARCHIVED';
    err.status = 409;
    throw err;
  }

  let trackingCategoryId;
  let categoryName;
  let wasCreated;

  if (group.status === 'POSSIBLE_MISMATCH') {
    if (decision === 'use_existing') {
      // Never trust a client-supplied id - re-look-up and re-verify the
      // EXACT category this group itself suggested, live, right now.
      const category = await xeroClient.getTrackingCategory(tenantId, group.suggestion.trackingCategoryId);
      if (!category || category.Status !== 'ACTIVE') {
        const err = new Error(`"${group.suggestion.name}" is no longer available in Xero. Please re-upload the file.`);
        err.code = 'SUGGESTION_NO_LONGER_AVAILABLE';
        err.status = 409;
        throw err;
      }
      trackingCategoryId = category.TrackingCategoryID;
      categoryName = category.Name;
      wasCreated = false;
    } else if (decision === 'create_new') {
      if (group.categoryLimitReached) {
        const err = new Error(
          `Cannot create "${group.categoryNameInFile}": this organisation already has ${group.activeCategoryCount} active `
          + `Tracking Categories, and Xero allows a maximum of ${XERO_ACTIVE_CATEGORY_LIMIT}.`,
        );
        err.code = 'ACTIVE_CATEGORY_LIMIT_REACHED';
        err.status = 409;
        throw err;
      }
      ({ trackingCategoryId, categoryName, created: wasCreated } = await trackingCategoryService.resolveOrCreateCategory(
        tenantId, group.categoryNameInFile,
      ));
    } else {
      // No silent default - the whole point of a mismatch prompt is that
      // the user, not the app, decides.
      const err = new Error(`A decision ("use_existing" or "create_new") is required for the possible mismatch on "${group.categoryNameInFile}".`);
      err.code = 'DECISION_REQUIRED';
      err.status = 400;
      throw err;
    }
  } else {
    // NOT_FOUND: unchanged from before - no decision needed, still a
    // single "Continue Import" click, still blocked up front if it would
    // exceed Xero's active-category limit (previously this only surfaced
    // as an error from resolveOrCreateCategory itself; now caught earlier
    // for a clearer message, same underlying protection either way).
    if (group.categoryLimitReached) {
      const err = new Error(
        `Cannot create "${group.categoryNameInFile}": this organisation already has ${group.activeCategoryCount} active `
        + `Tracking Categories, and Xero allows a maximum of ${XERO_ACTIVE_CATEGORY_LIMIT}.`,
      );
      err.code = 'ACTIVE_CATEGORY_LIMIT_REACHED';
      err.status = 409;
      throw err;
    }
    ({ trackingCategoryId, categoryName, created: wasCreated } = await trackingCategoryService.resolveOrCreateCategory(
      tenantId, group.categoryNameInFile,
    ));
  }

  const diff = await diffAgainstXero(tenantId, trackingCategoryId, group.uniqueOptions);
  const updated = { ...group, status: 'FOUND', trackingCategoryId, categoryName, wasCreated, ...diff };
  pending.groups[index] = updated;
  return toClientShape(updated);
}

/** Creates one persisted, resumable ImportJob per already-resolved (FOUND) group, and starts background processing. */
async function startImport(tenantId, uploadToken) {
  const pending = pendingUploads.get(uploadToken);
  if (!pending || pending.tenantId !== tenantId) {
    const err = new Error('Upload session expired or not found. Please re-upload the file.');
    err.code = 'UPLOAD_TOKEN_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  // A shared batchId ties together every job created from THIS upload, so
  // a file with several categories can be shown/polled as one aggregate
  // ("3 categories, 1,250 total options...") in addition to each
  // category's own independent job/progress/resume - see getBatchStatus().
  // A single-category upload still gets a batchId (for a uniform job
  // shape) but the frontend simply skips the aggregate view for it and
  // goes straight to that one job's existing page, unchanged.
  const batchId = `BATCH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const jobs = [];
  const skipped = [];

  for (const group of pending.groups) {
    if (group.status !== 'FOUND') {
      skipped.push({ key: group.key, categoryNameInFile: group.categoryNameInFile, reason: group.error || 'Not yet resolved to a Xero category.' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const job = await createJobForGroup(tenantId, pending.fileName, group.trackingCategoryId, group.categoryName, group.uniqueOptions, batchId);
    jobs.push(job);
  }

  pendingUploads.delete(uploadToken);
  return { batchId, jobs, skipped };
}

/** Creates + persists one ImportJob and starts its background processing. Shared by every resolved group. */
async function createJobForGroup(tenantId, fileName, trackingCategoryId, categoryName, uniqueOptions, batchId) {
  // Re-diff right before creating the job in case Xero changed underneath
  // us since preflight (someone else created one of these options meanwhile).
  const existingMap = await trackingOptionService.fetchExistingOptions(tenantId, trackingCategoryId);
  const newOptions = uniqueOptions.filter((name) => !existingMap.has(normalizeForCompare(name)));

  const importId = `IMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const job = {
    importId,
    batchId,
    tenantId,
    fileName,
    categoryName,
    trackingCategoryId,
    totalOptions: uniqueOptions.length,
    existingOptions: uniqueOptions.length - newOptions.length,
    newOptions: newOptions.length,
    successfulOptions: 0,
    failedOptions: 0,
    pendingOptions: newOptions.length,
    status: 'PENDING',
    cancelRequested: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.saveJob(job);

  const batchesOfNames = chunk(newOptions, BATCH_SIZE);
  const batchRecords = [];
  for (let i = 0; i < batchesOfNames.length; i += 1) {
    const names = batchesOfNames[i];
    for (const displayName of names) {
      // eslint-disable-next-line no-await-in-loop
      await store.saveOptionResult(importId, normalizeForCompare(displayName), {
        displayName,
        status: 'PENDING',
        attempts: 0,
        batchNumber: i + 1,
      });
    }
    batchRecords.push({
      importId,
      batchNumber: i + 1,
      optionNames: names.map((n) => normalizeForCompare(n)),
      status: 'PENDING',
      attempts: 0,
      successCount: 0,
      failedCount: 0,
    });
  }
  await store.saveBatches(importId, batchRecords);

  trackingBatchService.processJob(importId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[IMPORT] ${importId} crashed:`, err);
  });

  return job;
}

async function getStatus(importId) {
  const job = await store.getJob(importId);
  if (!job) return null;
  const batches = await store.getBatches(importId);
  return {
    ...job,
    batches: batches.map(({ optionNames, ...rest }) => rest),
    totalBatches: batches.length,
    completedBatches: batches.filter((b) => b.status === 'SUCCESS').length,
  };
}

async function getErrorReport(importId) {
  const results = await store.getOptionResults(importId);
  return Object.values(results)
    .filter((r) => r.status === 'FAILED')
    .map((r) => ({
      optionName: r.displayName,
      batchNumber: r.batchNumber,
      httpStatus: r.httpStatus,
      xeroError: r.xeroError,
      xeroErrorType: r.xeroErrorType || null,
      xeroValidationMessages: r.xeroValidationMessages || [],
      attempts: r.attempts,
      permanent: !!r.permanent,
    }));
}

async function listImports(tenantId) {
  const jobs = await store.listJobs();
  return jobs.filter((j) => j.tenantId === tenantId);
}

/**
 * Aggregates every job that shares a batchId (i.e. came from the same
 * upload) into one overview - "3 categories, 1,250 total options, 900
 * successful..." plus each category's own already-existing status. Purely
 * derived, read-time only, from the same persisted ImportJob records
 * getStatus() already reads - no separate state to keep in sync or lose on
 * a restart; each underlying job resumes exactly as it always did.
 */
async function getBatchStatus(tenantId, batchId) {
  const jobs = (await store.listJobs()).filter((j) => j.tenantId === tenantId && j.batchId === batchId);
  if (jobs.length === 0) return null;

  const categories = jobs.map((job) => ({
    importId: job.importId,
    categoryName: job.categoryName,
    trackingCategoryId: job.trackingCategoryId,
    totalOptions: job.totalOptions,
    newOptions: job.newOptions,
    existingOptions: job.existingOptions, // "already existing" = skipped, never attempted, never counted as failed
    successfulOptions: job.successfulOptions,
    failedOptions: job.failedOptions,
    pendingOptions: job.pendingOptions,
    status: job.status,
  }));

  const sum = (field) => categories.reduce((total, c) => total + (c[field] || 0), 0);
  const allTerminal = categories.every((c) => ['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(c.status));
  const anyFailed = categories.some((c) => c.status === 'FAILED');
  const anyPartial = categories.some((c) => c.status === 'PARTIAL');

  return {
    batchId,
    categoriesCount: categories.length,
    totalOptions: sum('totalOptions'),
    newOptionsTotal: sum('newOptions'),
    successfulTotal: sum('successfulOptions'),
    failedTotal: sum('failedOptions'),
    pendingTotal: sum('pendingOptions'),
    skippedTotal: sum('existingOptions'),
    // Overall status is a simple roll-up: still running if any category
    // is; otherwise the least-clean terminal state any category reached.
    status: !allTerminal ? 'PROCESSING' : anyFailed ? 'FAILED' : anyPartial ? 'PARTIAL' : 'SUCCESS',
    categories,
  };
}

async function resumeImport(importId) {
  return trackingBatchService.processJob(importId);
}

/** Retries ONLY currently-FAILED, non-permanent options, using the SAME TrackingCategoryID. */
async function retryFailed(importId) {
  return trackingBatchService.processJob(importId, { optionFilter: (r) => r.status === 'FAILED' });
}

async function cancelImport(importId) {
  await store.patchJob(importId, { cancelRequested: true, status: 'CANCELLED' });
  return store.getJob(importId);
}

module.exports = {
  validateUpload,
  resolveCategory,
  startImport,
  getStatus,
  getBatchStatus,
  getErrorReport,
  listImports,
  resumeImport,
  retryFailed,
  cancelImport,
};
