const crypto = require('crypto');
const xeroAuthService = require('../services/xeroAuthService');
const xeroConnectionService = require('../services/xeroConnectionService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5005';

/** GET /auth/xero - "Connect Xero" button lands here and gets redirected to Xero's login. */
function xeroLogin(req, res) {
  const state = crypto.randomUUID();
  req.session.oauthState = state;
  res.redirect(xeroAuthService.getAuthorizeUrl(state));
}

/**
 * GET /auth/xero/callback
 * Exchanges the code, discovers the user's organisation(s), stores the
 * connection, and sends the browser back to the frontend - auto-selecting
 * the organisation if there's only one (section 2, step 5).
 */
async function xeroCallback(req, res, next) {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(error)}`);
    }
    if (!code || !state || state !== req.session.oauthState) {
      return res.redirect(`${FRONTEND_URL}/login?error=invalid_state`);
    }
    delete req.session.oauthState;

    const { connectionId, connections } = await xeroConnectionService.completeOAuthLogin(code);
    req.session.connectionId = connectionId;

    if (connections.length === 1) {
      req.session.selectedTenantId = connections[0].tenantId;
      return res.redirect(`${FRONTEND_URL}/dashboard`);
    }
    return res.redirect(`${FRONTEND_URL}/select-organisation`);
  } catch (err) {
    next(err);
  }
}

/** POST /auth/xero/logout - clears the session; stored tokens are untouched (import jobs keep running). */
function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie('xti.sid');
    res.json({ success: true });
  });
}

/** GET /auth/xero/session - lightweight "am I logged in" check for the frontend router guard. */
function sessionStatus(req, res) {
  res.json({
    authenticated: !!req.session?.connectionId,
    selectedTenantId: req.session?.selectedTenantId || null,
  });
}

module.exports = { xeroLogin, xeroCallback, logout, sessionStatus };
