/**
 * Pure Xero OAuth 2.0 mechanics - no storage, no sessions. Every function
 * here is a stateless call to Xero's identity endpoints. Persistence and
 * "who is logged in" belong to xeroConnectionService.js instead, which
 * keeps this file trivial to reason about (and to swap if Xero ever
 * changes its auth flow).
 */
const axios = require('axios');

// Read lazily, INSIDE each function, rather than into module-level
// constants at require-time. Reading at require-time is fragile: which
// module a Node require-chain happens to load first (and therefore
// whether dotenv.config() has already run) is an implementation detail
// that shifts if any file's require order changes - it should never be
// able to freeze these as undefined. See server.js's own dotenv.config()
// call for the other, complementary half of this fix.
function config() {
  return {
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUri: process.env.XERO_REDIRECT_URI || 'http://localhost:7005/auth/xero/callback',
    // Granular scopes appropriate for reading/writing Tracking Categories &
    // Options, plus offline_access for refresh tokens. `accounting.contacts.read`
    // etc. are intentionally NOT requested - keep the consent screen minimal.
    scopes: process.env.XERO_SCOPES
      || 'openid profile email offline_access accounting.settings accounting.settings.read',
  };
}

function getAuthorizeUrl(state) {
  const { clientId, redirectUri, scopes } = config();
  if (!clientId) {
    throw Object.assign(new Error('XERO_CLIENT_ID is not configured on the server.'), { status: 500 });
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });
  return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const { clientId, clientSecret, redirectUri } = config();
  const res = await axios.post(
    'https://identity.xero.com/connect/token',
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );
  return { ...res.data, obtainedAt: Date.now() };
}

async function refreshTokenRaw(refreshToken) {
  const { clientId, clientSecret } = config();
  const res = await axios.post(
    'https://identity.xero.com/connect/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );
  return { ...res.data, obtainedAt: Date.now() };
}

/** GET /connections - the Xero organisations this token grants access to. */
async function fetchConnections(accessToken) {
  const res = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data; // [{ id, tenantId, tenantType, tenantName, ... }]
}

module.exports = { getAuthorizeUrl, exchangeCodeForToken, refreshTokenRaw, fetchConnections };
