/**
 * Lightweight, dependency-free persistence layer.
 *
 * Design goals:
 *  - Zero native/binary dependencies (works anywhere Node runs).
 *  - Crash-safe: every write goes to a temp file then is renamed
 *    (atomic on POSIX filesystems), so a crash mid-write never
 *    corrupts the store.
 *  - Simple enough to reason about; swap-in-place for Postgres/Mongo
 *    in production by re-implementing this module's exported API
 *    (the rest of the codebase only talks to this module).
 *
 * Collections stored, one JSON file per collection under DATA_DIR:
 *   importJobs.json        importId -> ImportJob
 *   importBatches.json     importId -> { [batchNumber]: Batch }
 *   optionResults.json     importId -> { [normalizedOptionName]: OptionResult }
 *   categoryLocks.json     tenantId::normalizedName -> TrackingCategoryID
 *   xeroConnections.json   connectionId -> { tokenSet, connections, createdAt, updatedAt }
 *   tenantIndex.json       tenantId -> connectionId   (lets a background job resolve a
 *                          fresh token for its tenant without any active browser session)
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/constants');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  jobs: path.join(DATA_DIR, 'importJobs.json'),
  batches: path.join(DATA_DIR, 'importBatches.json'),
  results: path.join(DATA_DIR, 'optionResults.json'),
  categoryMap: path.join(DATA_DIR, 'categoryLocks.json'),
  xeroConnections: path.join(DATA_DIR, 'xeroConnections.json'),
  tenantIndex: path.join(DATA_DIR, 'tenantIndex.json'),
};

// in-process write queue per file to serialize concurrent writes safely
const writeQueues = new Map();

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    // Corrupt file should never crash the server; log and start fresh
    // in memory (the file itself is left untouched for forensics).
    console.error(`[store] Failed to parse ${file}:`, err.message);
    return {};
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file); // atomic on same filesystem
}

/** Serializes read-modify-write cycles against a single file. */
function withFile(file, mutator) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.then(() => {
    const data = readJson(file);
    const result = mutator(data);
    writeJsonAtomic(file, data);
    return result;
  });
  writeQueues.set(file, next.catch(() => {}));
  return next;
}

// ---------------------------------------------------------------------
// Import Jobs
// ---------------------------------------------------------------------
async function saveJob(job) {
  return withFile(FILES.jobs, (data) => {
    data[job.importId] = job;
    return job;
  });
}

async function getJob(importId) {
  const data = readJson(FILES.jobs);
  return data[importId] || null;
}

async function listJobs() {
  const data = readJson(FILES.jobs);
  return Object.values(data).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function patchJob(importId, patch) {
  return withFile(FILES.jobs, (data) => {
    if (!data[importId]) throw new Error(`Import job ${importId} not found`);
    data[importId] = { ...data[importId], ...patch, updatedAt: new Date().toISOString() };
    return data[importId];
  });
}

// ---------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------
async function saveBatches(importId, batches) {
  return withFile(FILES.batches, (data) => {
    data[importId] = data[importId] || {};
    for (const b of batches) data[importId][b.batchNumber] = b;
    return batches;
  });
}

async function getBatches(importId) {
  const data = readJson(FILES.batches);
  const byNumber = data[importId] || {};
  return Object.values(byNumber).sort((a, b) => a.batchNumber - b.batchNumber);
}

async function patchBatch(importId, batchNumber, patch) {
  return withFile(FILES.batches, (data) => {
    data[importId] = data[importId] || {};
    const existing = data[importId][batchNumber] || { importId, batchNumber };
    data[importId][batchNumber] = { ...existing, ...patch };
    return data[importId][batchNumber];
  });
}

// ---------------------------------------------------------------------
// Per-option results (for error reports / idempotent re-runs)
// ---------------------------------------------------------------------
async function saveOptionResult(importId, normalizedName, result) {
  return withFile(FILES.results, (data) => {
    data[importId] = data[importId] || {};
    data[importId][normalizedName] = result;
    return result;
  });
}

async function getOptionResults(importId) {
  const data = readJson(FILES.results);
  return data[importId] || {};
}

// ---------------------------------------------------------------------
// Category resolution cache (tenantId::normalizedName -> TrackingCategoryID)
// Acts as the durable half of the category locking mechanism (see
// services/categoryLockService.js for the in-process mutex half).
// ---------------------------------------------------------------------
async function getCachedCategoryId(key) {
  const data = readJson(FILES.categoryMap);
  return data[key] || null;
}

async function setCachedCategoryId(key, trackingCategoryId) {
  return withFile(FILES.categoryMap, (data) => {
    data[key] = trackingCategoryId;
    return trackingCategoryId;
  });
}

// ---------------------------------------------------------------------
// Xero OAuth connections
//
// One "connection" = one successful OAuth login, which may authorize
// several Xero organisations (tenants) at once. Keyed by a generated
// connectionId so the token set is stored ONCE and shared by every tenant
// under it - refreshing it (Xero refresh tokens are single-use/rotating)
// updates every tenant's access in one place instead of racing.
// ---------------------------------------------------------------------
async function saveConnection(connectionId, data) {
  return withFile(FILES.xeroConnections, (store) => {
    store[connectionId] = { ...store[connectionId], ...data, updatedAt: new Date().toISOString() };
    return store[connectionId];
  });
}

async function getConnection(connectionId) {
  const data = readJson(FILES.xeroConnections);
  return data[connectionId] || null;
}

/** tenantId -> connectionId, so a background job only needs the tenantId it was created with. */
async function setTenantConnection(tenantId, connectionId) {
  return withFile(FILES.tenantIndex, (data) => {
    data[tenantId] = connectionId;
    return connectionId;
  });
}

async function getConnectionIdForTenant(tenantId) {
  const data = readJson(FILES.tenantIndex);
  return data[tenantId] || null;
}

module.exports = {
  saveJob,
  getJob,
  listJobs,
  patchJob,
  saveBatches,
  getBatches,
  patchBatch,
  saveOptionResult,
  getOptionResults,
  getCachedCategoryId,
  setCachedCategoryId,
  saveConnection,
  getConnection,
  setTenantConnection,
  getConnectionIdForTenant,
};
