/**
 * Owns "who is connected to Xero" - token storage, refresh, and the
 * tenantId -> connectionId index that lets background import jobs keep
 * working even after the browser session that started them is long gone.
 *
 * This is the ONLY place that reads/writes Xero tokens. Controllers and
 * xeroClient.js never see a token - they ask for one by tenantId
 * (background jobs) or read the caller's selected tenant off req.session
 * (interactive requests).
 */
const crypto = require('crypto');
const store = require('../db/store');
const xeroAuthService = require('./xeroAuthService');
const { withLock } = require('./categoryLockService'); // generic keyed mutex, reused here

const REFRESH_SAFETY_WINDOW_MS = 60_000;

/**
 * Completes the OAuth callback: exchanges the code, discovers every
 * organisation the user just authorized, and persists ONE token set shared
 * by all of them (see store.js header comment on why this must be shared,
 * not duplicated - Xero refresh tokens are single-use/rotating).
 *
 * Returns { connectionId, connections } for the caller to put in session.
 */
async function completeOAuthLogin(code) {
  const tokenSet = await xeroAuthService.exchangeCodeForToken(code);
  const connections = await xeroAuthService.fetchConnections(tokenSet.access_token);

  if (connections.length === 0) {
    const err = new Error('Xero authorized the app but returned no organisations to connect.');
    err.code = 'NO_XERO_ORGANISATIONS';
    throw err;
  }

  const connectionId = crypto.randomUUID();
  await store.saveConnection(connectionId, { tokenSet, connections, createdAt: new Date().toISOString() });
  await Promise.all(connections.map((c) => store.setTenantConnection(c.tenantId, connectionId)));

  return { connectionId, connections };
}

async function getConnectionsById(connectionId) {
  const conn = await store.getConnection(connectionId);
  if (!conn) return [];
  return conn.connections;
}

function isExpiring(tokenSet) {
  const ageMs = Date.now() - (tokenSet.obtainedAt || 0);
  const expiresInMs = (tokenSet.expires_in || 1800) * 1000;
  return ageMs >= expiresInMs - REFRESH_SAFETY_WINDOW_MS;
}

/** Refreshes (if needed) and returns a valid access token for the given connectionId. */
async function getValidAccessTokenForConnection(connectionId) {
  // Locked per-connection: Xero refresh tokens are single-use, so two
  // concurrent callers (e.g. two batches racing near token expiry) must
  // not both attempt a refresh - the second would get an invalid_grant.
  return withLock(`xero-refresh::${connectionId}`, async () => {
    const conn = await store.getConnection(connectionId);
    if (!conn) {
      const err = new Error('Xero connection not found. Please reconnect.');
      err.code = 'XERO_NOT_CONNECTED';
      err.status = 401;
      throw err;
    }
    if (!isExpiring(conn.tokenSet)) return conn.tokenSet.access_token;

    const refreshed = await xeroAuthService.refreshTokenRaw(conn.tokenSet.refresh_token);
    await store.saveConnection(connectionId, { tokenSet: refreshed });
    return refreshed.access_token;
  });
}

/** What xeroClient.js and background jobs actually call - resolves by tenantId alone. */
async function getValidAccessTokenForTenant(tenantId) {
  const connectionId = await store.getConnectionIdForTenant(tenantId);
  if (!connectionId) {
    const err = new Error(`No Xero connection found for tenant ${tenantId}. Please reconnect.`);
    err.code = 'XERO_NOT_CONNECTED';
    err.status = 401;
    throw err;
  }
  return getValidAccessTokenForConnection(connectionId);
}

async function getOrganisationName(tenantId) {
  const connectionId = await store.getConnectionIdForTenant(tenantId);
  if (!connectionId) return null;
  const connections = await getConnectionsById(connectionId);
  return connections.find((c) => c.tenantId === tenantId)?.tenantName || null;
}

module.exports = {
  completeOAuthLogin,
  getConnectionsById,
  getValidAccessTokenForTenant,
  getOrganisationName,
};
