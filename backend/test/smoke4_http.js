// End-to-end HTTP smoke test: OAuth callback -> session cookie -> org
// selection -> tenant-scoped tracking-categories call -> import validate/start,
// all through real Express routes/middleware with only the Xero network layer stubbed.
const Module = require('module');
const origLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === './xeroAuthService' || request === '../services/xeroAuthService') {
    return {
      getAuthorizeUrl: (state) => `https://login.xero.com/identity/connect/authorize?state=${state}`,
      exchangeCodeForToken: async () => ({ access_token: 'tok1', refresh_token: 'ref1', expires_in: 1800, obtainedAt: Date.now() }),
      refreshTokenRaw: async () => ({ access_token: 'tok2', refresh_token: 'ref2', expires_in: 1800, obtainedAt: Date.now() }),
      fetchConnections: async () => ([
        { id: 'c1', tenantId: 'TENANT-A', tenantName: 'Event Audio Visual Services Pty Ltd', tenantType: 'ORGANISATION' },
        { id: 'c2', tenantId: 'TENANT-B', tenantName: 'Another Company', tenantType: 'ORGANISATION' },
      ]),
    };
  }
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async (tenantId) => ([
        { TrackingCategoryID: 'CAT-1', Name: 'Department', Status: 'ACTIVE', Options: [{ TrackingOptionID: 'O1', Name: 'HR', Status: 'ACTIVE' }] },
      ]),
      getTrackingCategory: async (tenantId, id) => ({ TrackingCategoryID: id, Name: 'Department', Status: 'ACTIVE', Options: [{ TrackingOptionID: 'O1', Name: 'HR', Status: 'ACTIVE' }] }),
      createTrackingOption: async () => { throw new Error('not used in this test'); },
    };
  }
  return origLoad.apply(this, arguments);
};

function extractCookie(setCookieHeader) {
  return setCookieHeader.split(';')[0];
}

async function main() {
  process.env.XERO_CLIENT_ID = 'fake';
  process.env.XERO_CLIENT_SECRET = 'fake';
  const app = require('../src/app');
  const server = app.listen(4004);
  const base = 'http://localhost:4004';

  try {
    // 1. GET /auth/xero -> capture the session cookie set even on the redirect
    let res = await fetch(`${base}/auth/xero`, { redirect: 'manual' });
    const cookie = extractCookie(res.headers.get('set-cookie'));
    console.log('1. /auth/xero ->', res.status, 'cookie:', cookie.slice(0, 20) + '...');

    // 2. Simulate the callback (state must match what was stored in session, so
    //    we need the same cookie AND the state from the redirect URL).
    const loc = new URL(res.headers.get('location'));
    const state = loc.searchParams.get('state');
    res = await fetch(`${base}/auth/xero/callback?code=fakecode&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    const cookie2 = res.headers.get('set-cookie') ? extractCookie(res.headers.get('set-cookie')) : cookie;
    console.log('2. /auth/xero/callback ->', res.status, '-> redirects to', res.headers.get('location'));

    // 3. GET /api/xero/connections (both orgs should be listed)
    res = await fetch(`${base}/api/xero/connections`, { headers: { Cookie: cookie2 } });
    const connBody = await res.json();
    console.log('3. connections ->', res.status, JSON.stringify(connBody));

    // 4. POST /api/xero/select-connection with a tenantId NOT in the list -> must be rejected
    res = await fetch(`${base}/api/xero/select-connection`, {
      method: 'POST', headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'TENANT-EVIL' }),
    });
    console.log('4. select-connection with bogus tenantId ->', res.status, JSON.stringify(await res.json()));

    // 5. POST /api/xero/select-connection with a real tenantId
    res = await fetch(`${base}/api/xero/select-connection`, {
      method: 'POST', headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'TENANT-B' }),
    });
    console.log('5. select-connection TENANT-B ->', res.status, JSON.stringify(await res.json()));

    // 6. GET /api/xero/tracking-categories (now that a tenant is selected)
    res = await fetch(`${base}/api/xero/tracking-categories`, { headers: { Cookie: cookie2 } });
    console.log('6. tracking-categories ->', res.status, JSON.stringify(await res.json()));

    // 7. GET /api/tracking/import (should be empty list, but 200 now that tenant selected)
    res = await fetch(`${base}/api/tracking/import`, { headers: { Cookie: cookie2 } });
    console.log('7. import list ->', res.status, JSON.stringify(await res.json()));

    // 8. Logout, then confirm session endpoints go back to 401
    res = await fetch(`${base}/auth/xero/logout`, { method: 'POST', headers: { Cookie: cookie2 } });
    console.log('8. logout ->', res.status, JSON.stringify(await res.json()));

    res = await fetch(`${base}/api/xero/connections`, { headers: { Cookie: cookie2 } });
    console.log('9. connections after logout (expect 401) ->', res.status);
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
