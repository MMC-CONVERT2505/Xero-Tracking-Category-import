const trackingImportService = require('../services/trackingImportService');

function requireTenant(req) {
  const tenantId = req.body.tenantId || req.query.tenantId;
  if (!tenantId) {
    const err = new Error('tenantId is required (pass it in the request body or query string).');
    err.status = 400;
    throw err;
  }
  return tenantId;
}

async function validate(req, res, next) {
  try {
    const tenantId = requireTenant(req);
    if (!req.file) {
      return res.status(400).json({ error: { message: 'No file uploaded. Field name must be "file".' } });
    }
    const result = await trackingImportService.validateUpload(tenantId, req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function start(req, res, next) {
  try {
    const tenantId = requireTenant(req);
    const { uploadToken, categoryKeys } = req.body;
    if (!uploadToken) return res.status(400).json({ error: { message: 'uploadToken is required.' } });
    const jobs = await trackingImportService.startImport(tenantId, uploadToken, categoryKeys);
    // Return immediately - processing continues in the background (section 29).
    res.status(202).json({ jobs });
  } catch (err) {
    next(err);
  }
}

async function status(req, res, next) {
  try {
    const job = await trackingImportService.getStatus(req.params.importId);
    if (!job) return res.status(404).json({ error: { message: 'Import job not found.' } });
    res.json(job);
  } catch (err) {
    next(err);
  }
}

async function errors(req, res, next) {
  try {
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

module.exports = { validate, start, status, errors, resume, retryFailed, cancel };
