/**
 * @typedef {Object} ImportJob
 * @property {string} importId              e.g. "IMP-A1B2C3D4"
 * @property {string} tenantId              Xero organisation this job belongs to
 * @property {string} fileName
 * @property {string} categoryName
 * @property {string} trackingCategoryId    source of truth for every batch/option in this job
 * @property {number} totalOptions          unique options found in the file
 * @property {number} existingOptions       already present (ACTIVE) in Xero, skipped
 * @property {number} newOptions            queued to be created
 * @property {number} successfulOptions
 * @property {number} failedOptions
 * @property {number} pendingOptions
 * @property {'PENDING'|'PROCESSING'|'SUCCESS'|'PARTIAL'|'FAILED'|'CANCELLED'} status
 * @property {boolean} cancelRequested
 * @property {string} createdAt   ISO timestamp
 * @property {string} updatedAt   ISO timestamp
 */

// Persisted via db/store.js (saveJob/getJob/listJobs/patchJob). Not a class -
// the store deals in plain JSON, so this file exists purely to document the
// shape referenced throughout services/trackingImportService.js and
// services/trackingBatchService.js.
module.exports = {};
