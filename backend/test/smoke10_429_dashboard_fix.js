// Issue 1 regression test.
//
// Part A: proves createTrackingOption's retry count is UNCHANGED - still
// retried exactly once externally by trackingBatchService (not double-
// wrapped by the new callProtected() added to the other 3 functions).
//
// Part B: proves listTrackingCategories/getTrackingCategory/
// createTrackingCategory now transparently survive a transient 429/500
// (via the SAME, unmodified rateLimiter+retryService) instead of the raw
// Axios error reaching the caller - through the REAL HTTP layer, so this
// checks the actual dashboard endpoint the bug report named.
process.env.MAX_RETRIES = '2';
process.env.XERO_CLIENT_ID = 'fake';
process.env.XERO_CLIENT_SECRET = 'fake';
process.env.XERO_MAX_REQUESTS_PER_MINUTE = '100000';

const Module = require('module');
const origLoad = Module._load;

let optionCallAttempts = 0;
let dashboardCallAttempts = 0;
let fakeCategories = [{ TrackingCategoryID: 'CAT-1', Name: 'Class', Status: 'ACTIVE', Options: [] }];

function transient429() {
  const err = new Error('Request failed with status code 429');
  err.response = { status: 429, headers: { 'retry-after': '0' }, data: { Message: 'Rate limit exceeded' } };
  return err;
}

Module._load = function (request, parent, isMain) {
  if (request === './xeroAuthService' || request === '../services/xeroAuthService') {
    return {
      getAuthorizeUrl: (s) => `https://login.xero.com/identity/connect/authorize?state=${s}`,
      exchangeCodeForToken: async () => ({ access_token: 'SECRET-TOKEN-ABC123XYZ', refresh_token: 'SECRET-REFRESH-XYZ', expires_in: 1800, obtainedAt: Date.now() }),
      refreshTokenRaw: async () => ({ access_token: 'SECRET-TOKEN-ROUND2', refresh_token: 'SECRET-REFRESH-ROUND2', expires_in: 1800, obtainedAt: Date.now() }),
      fetchConnections: async () => ([{ id: 'c1', tenantId: 'T1', tenantName: 'Test Co', tenantType: 'ORGANISATION' }]),
    };
  }
  return origLoad.apply(this, arguments);
};

async function main() {
  // Capture every [XERO_CALL] log line to prove no token/Authorization
  // value ever appears in it (the diagnostic logger reads only
  // err.response/res.headers, never err.config, but let's prove it).
  const FAKE_TOKEN_MARKER = 'SECRET-TOKEN'; // shared prefix of every stubbed token used below
  const loggedLines = [];
  const origConsoleLog = console.log;
  console.log = (...args) => { loggedLines.push(args.map(String).join(' ')); origConsoleLog(...args); };

  // --- Part A: createTrackingOption retry count is unchanged ---
  {
    const xeroClientPath = require.resolve('../src/services/xeroClient');
    delete require.cache[xeroClientPath];
    // Stub only axios (real xeroClient.js code runs, including callProtected
    // and withDiagnostics) so we can count real underlying HTTP attempts.
    const connSvcPath = require.resolve('../src/services/xeroConnectionService');
    require.cache[connSvcPath] = { exports: { getValidAccessTokenForTenant: async () => 'SECRET-TOKEN-PARTA' } };
    const axiosPath = require.resolve('axios');
    const realAxiosPut = require('axios').put;
    require.cache[axiosPath].exports = {
      ...require.cache[axiosPath].exports,
      put: async (url, body, opts) => {
        if (url.includes('/Options')) {
          optionCallAttempts += 1;
          throw transient429();
        }
        return realAxiosPut(url, body, opts);
      },
      get: async () => { throw new Error('not used in part A'); },
    };

    const xeroClient = require('../src/services/xeroClient');
    try {
      await xeroClient.createTrackingOption('T1', 'CAT-1', 'Sales', 'idem-key-1');
    } catch (e) { /* expected to exhaust and throw */ }

    console.log(`Part A: createTrackingOption made ${optionCallAttempts} attempt(s) at the xeroClient layer (expect exactly 1 - no rate-limit/retry wrapping was added here).`);
    if (optionCallAttempts !== 1) {
      throw new Error(`FAIL: xeroClient.createTrackingOption should make exactly 1 raw attempt itself (retry lives externally in trackingBatchService, unchanged) - got ${optionCallAttempts}`);
    }
  }

  // --- Part B: real HTTP dashboard call now survives a transient 429 ---
  delete require.cache[require.resolve('../src/services/xeroClient')];
  delete require.cache[require.resolve('../src/services/xeroConnectionService')];
  delete require.cache[require.resolve('../src/db/store')];
  const axiosModule = require('axios');
  const realGet = axiosModule.get;
  axiosModule.get = async (url, opts) => {
    if (url.includes('/TrackingCategories') && !url.includes('/Options')) {
      dashboardCallAttempts += 1;
      if (dashboardCallAttempts <= 2) throw transient429(); // first 2 calls: Xero is rate limiting
      return { status: 200, headers: {}, data: { TrackingCategories: fakeCategories } };
    }
    return realGet(url, opts);
  };

  const app = require('../src/app');
  const server = app.listen(4097);
  const base = 'http://localhost:4097';

  try {
    let res = await fetch(`${base}/auth/xero`, { redirect: 'manual' });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const state = new URL(res.headers.get('location')).searchParams.get('state');
    res = await fetch(`${base}/auth/xero/callback?code=x&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const cookie2 = res.headers.get('set-cookie').split(';')[0];

    console.log('\nCalling GET /api/xero/dashboard while Xero is transiently 429-ing the first 2 attempts...');
    res = await fetch(`${base}/api/xero/dashboard`, { headers: { Cookie: cookie2 } });
    const body = await res.json();

    console.log('dashboard response status:', res.status);
    console.log('underlying Xero calls attempted:', dashboardCallAttempts, '(expect 3: 2 x 429 then success)');

    if (res.status !== 200) {
      throw new Error(`FAIL: dashboard should have transparently recovered via retry, got HTTP ${res.status}: ${JSON.stringify(body)}`);
    }
    if (dashboardCallAttempts !== 3) {
      throw new Error(`FAIL: expected exactly 3 underlying attempts (2 failed + 1 success), got ${dashboardCallAttempts}`);
    }
    console.log('Part B PASSED - the dashboard never saw a 429 at all; it was absorbed by the same retry logic options already use.');
  } finally {
    server.close();
  }

  const reportText = loggedLines.join('\n');
  console.log = origConsoleLog;
  if (reportText.includes(FAKE_TOKEN_MARKER) || reportText.toLowerCase().includes('bearer') || reportText.toLowerCase().includes('authorization')) {
    throw new Error('FAIL: SECURITY - a token/Authorization value leaked into the [XERO_CALL] diagnostic logs');
  }
  console.log('Security check passed: no token/Authorization value in any diagnostic log line.');

  console.log('\nALL ASSERTIONS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
