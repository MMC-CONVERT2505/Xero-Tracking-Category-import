/**
 * Cookie session config. The session only ever holds two small values:
 *   req.session.connectionId    - which stored Xero token set this browser is using
 *   req.session.selectedTenantId - which of that connection's organisations is active
 *
 * Everything else Xero-related (tokens, org list) is looked up from the
 * durable store by connectionId - the session itself is disposable and
 * safe to lose (the user just reconnects; any in-flight import job keeps
 * running regardless, see xeroConnectionService.js).
 *
 * MemoryStore (the express-session default) is fine for a single-instance
 * deployment / local dev. For multi-instance production, swap in
 * connect-redis or similar - only this file changes.
 */
const session = require('express-session');

const isProd = process.env.NODE_ENV === 'production';

module.exports = session({
  name: 'xti.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd, // requires HTTPS in production
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});
