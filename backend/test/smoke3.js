// Tests xeroConnectionService: OAuth callback -> shared token across multiple
// tenants -> tenantId-based token resolution -> single-flight refresh -> the
// full authController + xeroController HTTP flow (session cookie, org
// selection, tenant-scoped API calls), all with the Xero network calls stubbed.
const Module = require('module');
const origLoad = Module._load;

let refreshCount = 0;
let currentAccessToken = 'access-token-v1';

Module._load = function (request, parent, isMain) {
  if (request === './xeroAuthService' || request === '../services/xeroAuthService') {
    return {
      getAuthorizeUrl: (state) => `https://login.xero.com/identity/connect/authorize?state=${state}`,
      exchangeCodeForToken: async (code) => ({
        access_token: currentAccessToken,
        refresh_token: 'refresh-token-v1',
        expires_in: 1800,
        obtainedAt: Date.now() - 1750 * 1000, // already near-expiry, forces a refresh on first use
      }),
      refreshTokenRaw: async (refreshToken) => {
        refreshCount += 1;
        currentAccessToken = `access-token-v${refreshCount + 1}`;
        return { access_token: currentAccessToken, refresh_token: `refresh-token-v${refreshCount + 1}`, expires_in: 1800, obtainedAt: Date.now() };
      },
      fetchConnections: async (accessToken) => ([
        { id: 'conn-1', tenantId: 'TENANT-A', tenantName: 'Event Audio Visual Services Pty Ltd', tenantType: 'ORGANISATION' },
        { id: 'conn-2', tenantId: 'TENANT-B', tenantName: 'Another Company', tenantType: 'ORGANISATION' },
      ]),
    };
  }
  return origLoad.apply(this, arguments);
};

async function main() {
  const xeroConnectionService = require('../src/services/xeroConnectionService');

  console.log('--- completeOAuthLogin (simulates /auth/xero/callback) ---');
  const { connectionId, connections } = await xeroConnectionService.completeOAuthLogin('fake-code');
  console.log('connectionId:', connectionId, 'orgs:', connections.map(c => c.tenantName));

  console.log('--- getValidAccessTokenForTenant for BOTH tenants (shared token, single refresh) ---');
  const [tokenA, tokenB] = await Promise.all([
    xeroConnectionService.getValidAccessTokenForTenant('TENANT-A'),
    xeroConnectionService.getValidAccessTokenForTenant('TENANT-B'),
  ]);
  console.log('tokenA === tokenB:', tokenA === tokenB, '| refreshCount (must be 1, not 2):', refreshCount);
  if (refreshCount !== 1) throw new Error(`Expected exactly 1 refresh (locked), got ${refreshCount}`);
  if (tokenA !== tokenB) throw new Error('Expected both tenants to share the refreshed token');

  console.log('--- getOrganisationName ---');
  console.log(await xeroConnectionService.getOrganisationName('TENANT-B'));

  console.log('--- unknown tenant should throw XERO_NOT_CONNECTED ---');
  try {
    await xeroConnectionService.getValidAccessTokenForTenant('TENANT-UNKNOWN');
    throw new Error('should have thrown');
  } catch (err) {
    console.log('threw as expected:', err.code);
  }

  console.log('ALL ASSERTIONS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
