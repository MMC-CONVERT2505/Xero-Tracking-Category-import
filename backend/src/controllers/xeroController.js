const xeroClient = require('../services/xeroClient');
const xeroConnectionService = require('../services/xeroConnectionService');
const store = require('../db/store');

/** GET /api/xero/connections - every organisation available on the current session's connection. */
async function connections(req, res, next) {
  try {
    const list = await xeroConnectionService.getConnectionsById(req.session.connectionId);
    res.json({
      connections: list.map((c) => ({ tenantId: c.tenantId, tenantName: c.tenantName, tenantType: c.tenantType })),
      selectedTenantId: req.session.selectedTenantId || null,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/xero/select-connection - { tenantId } - user picks an org from the selection screen. */
async function selectConnection(req, res, next) {
  try {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: { message: 'tenantId is required.' } });

    const list = await xeroConnectionService.getConnectionsById(req.session.connectionId);
    const match = list.find((c) => c.tenantId === tenantId);
    if (!match) {
      // Never trust a tenantId that isn't actually part of this session's authorized
      // connection (section 27: verify it belongs to the authenticated organisation).
      return res.status(403).json({ error: { code: 'TENANT_NOT_AUTHORIZED', message: 'That organisation is not part of your Xero connection.' } });
    }
    req.session.selectedTenantId = tenantId;
    res.json({ selectedTenantId: tenantId, tenantName: match.tenantName });
  } catch (err) {
    next(err);
  }
}

/** GET /api/xero/current-connection */
async function currentConnection(req, res, next) {
  try {
    if (!req.session.selectedTenantId) return res.status(204).end();
    const name = await xeroConnectionService.getOrganisationName(req.session.selectedTenantId);
    res.json({ tenantId: req.session.selectedTenantId, tenantName: name });
  } catch (err) {
    next(err);
  }
}

async function listTrackingCategories(req, res, next) {
  try {
    const categories = await xeroClient.listTrackingCategories(req.tenantId, { includeArchived: true });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
}

async function getTrackingCategory(req, res, next) {
  try {
    const category = await xeroClient.getTrackingCategory(req.tenantId, req.params.trackingCategoryId);
    if (!category) return res.status(404).json({ error: { message: 'Tracking category not found.' } });
    res.json({ category });
  } catch (err) {
    next(err);
  }
}

async function getTrackingCategoryOptions(req, res, next) {
  try {
    const category = await xeroClient.getTrackingCategory(req.tenantId, req.params.trackingCategoryId);
    if (!category) return res.status(404).json({ error: { message: 'Tracking category not found.' } });
    res.json({ options: category.Options || [] });
  } catch (err) {
    next(err);
  }
}

/** GET /api/dashboard - real, live-computed summary for the Dashboard page (section 29). */
async function dashboardSummary(req, res, next) {
  try {
    const [tenantName, categories, jobs] = await Promise.all([
      xeroConnectionService.getOrganisationName(req.tenantId),
      xeroClient.listTrackingCategories(req.tenantId, { includeArchived: true }),
      store.listJobs(),
    ]);

    const activeCategories = categories.filter((c) => c.Status === 'ACTIVE');
    const totalActiveOptions = activeCategories.reduce(
      (sum, c) => sum + (c.Options || []).filter((o) => o.Status === 'ACTIVE').length,
      0,
    );
    const tenantJobs = jobs.filter((j) => j.tenantId === req.tenantId);
    const recentImports = tenantJobs.slice(0, 5);

    res.json({
      tenantId: req.tenantId,
      tenantName,
      trackingCategoriesCount: categories.length,
      activeCategoriesCount: activeCategories.length,
      totalActiveOptions,
      totalImports: tenantJobs.length,
      recentImports,
      lastImportStatus: tenantJobs[0]?.status || null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  connections,
  selectConnection,
  currentConnection,
  listTrackingCategories,
  getTrackingCategory,
  getTrackingCategoryOptions,
  dashboardSummary,
};
