/**
 * Blocks routes that need a SELECTED organisation (not just "connected").
 * Also attaches req.tenantId so controllers never read the session shape
 * directly - keeps the session's internal structure private to this file
 * and requireAuth.js.
 */
module.exports = function requireTenant(req, res, next) {
  if (!req.session?.connectionId) {
    return res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'Not connected to Xero.' } });
  }
  if (!req.session?.selectedTenantId) {
    return res.status(409).json({
      error: { code: 'NO_ORGANISATION_SELECTED', message: 'Select a Xero organisation first.' },
    });
  }
  req.tenantId = req.session.selectedTenantId;
  next();
};
