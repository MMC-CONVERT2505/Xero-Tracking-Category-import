/**
 * Minimal Xero OAuth2 (Authorization Code + refresh) handling.
 *
 * Tokens are kept server-side only (never sent to the React frontend - see
 * section 27 of the spec / README "Security"). Persisted to the same JSON
 * store used for jobs so a server restart doesn't force a re-login.
 *
 * For a real production deployment, swap the file-backed token store for
 * your secrets manager / encrypted DB column - the two functions below
 * (`getTokenSet` / `saveTokenSet`) are the only integration points.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/constants');

const TOKEN_FILE = path.join(DATA_DIR, 'xeroTokens.json');

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const XERO_REDIRECT_URI = process.env.XERO_REDIRECT_URI || 'http://localhost:7005/api/xero/callback';
const XERO_SCOPES = process.env.XERO_SCOPES
  || 'offline_access accounting.settings accounting.settings.read';

function readTokenFile() {
  if (!fs.existsSync(TOKEN_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeTokenFile(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: XERO_CLIENT_ID,
    redirect_uri: XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state,
  });
  return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const res = await axios.post(
    'https://identity.xero.com/connect/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: XERO_REDIRECT_URI,
    }),
    {
      auth: { username: XERO_CLIENT_ID, password: XERO_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );
  const tokenSet = { ...res.data, obtainedAt: Date.now() };
  await persistTokenSetAndTenants(tokenSet);
  return tokenSet;
}

async function refreshToken(refresh_token) {
  const res = await axios.post(
    'https://identity.xero.com/connect/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token }),
    {
      auth: { username: XERO_CLIENT_ID, password: XERO_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );
  const tokenSet = { ...res.data, obtainedAt: Date.now() };
  const data = readTokenFile();
  writeTokenFile({ ...data, ...tokenSet });
  return tokenSet;
}

async function persistTokenSetAndTenants(tokenSet) {
  const conn = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${tokenSet.access_token}` },
  });
  writeTokenFile({ ...tokenSet, connections: conn.data });
  return conn.data;
}

/** Returns a valid access token, refreshing if it's expired/near expiry. */
async function getValidAccessToken() {
  const data = readTokenFile();
  if (!data.access_token) {
    throw Object.assign(new Error('Not connected to Xero. Visit /api/xero/connect first.'), {
      code: 'XERO_NOT_CONNECTED',
    });
  }
  const ageMs = Date.now() - (data.obtainedAt || 0);
  const expiresInMs = (data.expires_in || 1800) * 1000;
  if (ageMs < expiresInMs - 60_000) return data.access_token;

  const refreshed = await refreshToken(data.refresh_token);
  return refreshed.access_token;
}

function getConnectedTenants() {
  const data = readTokenFile();
  return data.connections || [];
}

module.exports = {
  getAuthorizeUrl,
  exchangeCodeForToken,
  getValidAccessToken,
  getConnectedTenants,
};
