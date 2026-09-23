/** Blocks routes that need an active Xero connection (any organisation). */
module.exports = function requireAuth(req, res, next) {
  if (!req.session?.connectionId) {
    return res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'Not connected to Xero.' } });
  }
  next();
};
