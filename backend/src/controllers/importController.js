/**
 * Import-job-lifecycle endpoints (category *reads* live in xeroController.js).
 * tenantId always comes from req.tenantId, attached by the requireTenant
 * middleware from the session - never from the request body/query.
 */
const trackingImportService = require('../services/trackingImportService');

async function validate(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'No file uploaded. Field name must be "file".' } });
    }
    // No trackingCategoryId here - the category is auto-detected from the
    // file's own structure (first column header per sheet).
    const result = await trackingImportService.validateUpload(req.tenantId, req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * The "Continue Import" action for one NOT_FOUND category: finds-or-creates
 * it in Xero. If category creation fails, the error is returned as-is and
 * nothing is imported for that category (see trackingCategoryService).
 */
async function resolveCategory(req, res, next) {
  try {
    const { uploadToken, key } = req.body;
    if (!uploadToken || !key) return res.status(400).json({ error: { message: 'uploadToken and key are required.' } });
    const category = await trackingImportService.resolveCategory(req.tenantId, uploadToken, key);
    res.json({ category });
  } catch (err) {
    next(err);
  }
}

async function start(req, res, next) {
  try {
    const { uploadToken } = req.body;
    if (!uploadToken) return res.status(400).json({ error: { message: 'uploadToken is required.' } });
    const result = await trackingImportService.startImport(req.tenantId, uploadToken);
    // Returns immediately - processing continues in the background.
    res.status(202).json(result); // { jobs: [...], skipped: [...] }
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const jobs = await trackingImportService.listImports(req.tenantId);
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
}

async function status(req, res, next) {
  try {
    const job = await trackingImportService.getStatus(req.params.importId);
    if (!job || job.tenantId !== req.tenantId) {
      return res.status(404).json({ error: { message: 'Import job not found.' } });
    }
    // This endpoint is polled every ~1s while an import runs - make sure
    // no browser/proxy layer ever serves a stale cached response instead
    // of hitting the backend for the current persisted state.
    res.set('Cache-Control', 'no-store');
    res.json(job);
  } catch (err) {
    next(err);
  }
}

async function errors(req, res, next) {
  try {
    const job = await trackingImportService.getStatus(req.params.importId);
    if (!job || job.tenantId !== req.tenantId) {
      return res.status(404).json({ error: { message: 'Import job not found.' } });
    }
    const report = await trackingImportService.getErrorReport(req.params.importId);
    res.json({ importId: req.params.importId, errors: report });
  } catch (err) {
    next(err);
  }
}

async function resume(req, res, next) {
  try {
    const job = await trackingImportService.resumeImport(req.params.importId);
    res.json(job);
  } catch (err) {
    next(err);
  }
}

async function retryFailed(req, res, next) {
  try {
    const job = await trackingImportService.retryFailed(req.params.importId);
    res.json(job);
  } catch (err) {
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const job = await trackingImportService.cancelImport(req.params.importId);
    res.json(job);
  } catch (err) {
    next(err);
  }
}

module.exports = { validate, resolveCategory, start, list, status, errors, resume, retryFailed, cancel };
