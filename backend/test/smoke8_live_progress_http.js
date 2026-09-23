// Same regression as smoke7, but through the REAL Express HTTP layer
// (session cookie, requireTenant middleware, the actual GET /status
// route) - proves the fix reaches the frontend's actual network call,
// and that the no-store Cache-Control header is present.
process.env.XERO_MAX_REQUESTS_PER_MINUTE = '100000';
process.env.XERO_MAX_CONCURRENT_REQUESTS = '5';
process.env.BATCH_SIZE = '50';
process.env.XERO_CLIENT_ID = 'fake';
process.env.XERO_CLIENT_SECRET = 'fake';

const Module = require('module');
const origLoad = Module._load;
let fakeCategories = [{ TrackingCategoryID: 'CAT-1', Name: 'Class', Status: 'ACTIVE', Options: [] }];

Module._load = function (request, parent, isMain) {
  if (request === './xeroAuthService' || request === '../services/xeroAuthService') {
    return {
      getAuthorizeUrl: (state) => `https://login.xero.com/identity/connect/authorize?state=${state}`,
      exchangeCodeForToken: async () => ({ access_token: 'tok1', refresh_token: 'ref1', expires_in: 1800, obtainedAt: Date.now() }),
      refreshTokenRaw: async () => ({ access_token: 'tok2', refresh_token: 'ref2', expires_in: 1800, obtainedAt: Date.now() }),
      fetchConnections: async () => ([{ id: 'c1', tenantId: 'T1', tenantName: 'Test Co', tenantType: 'ORGANISATION' }]),
    };
  }
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (t, id) => fakeCategories.find(c => c.TrackingCategoryID === id),
      createTrackingCategory: async () => { throw new Error('not used'); },
      createTrackingOption: async (t, categoryId, name) => {
        await new Promise((r) => setTimeout(r, 15));
        const opt = { TrackingOptionID: `OPT-${Math.random()}`, Name: name, Status: 'ACTIVE' };
        fakeCategories.find(c => c.TrackingCategoryID === categoryId).Options.push(opt);
        return { Options: [opt] };
      },
    };
  }
  return origLoad.apply(this, arguments);
};

function extractCookie(setCookieHeader) { return setCookieHeader.split(';')[0]; }

async function main() {
  const app = require('../src/app');
  const XLSX = require('xlsx');
  const fs = require('fs');
  const server = app.listen(4098);
  const base = 'http://localhost:4098';

  try {
    // Log in through the real OAuth + session flow (single org -> auto-selected).
    let res = await fetch(`${base}/auth/xero`, { redirect: 'manual' });
    const cookie = extractCookie(res.headers.get('set-cookie'));
    const state = new URL(res.headers.get('location')).searchParams.get('state');
    res = await fetch(`${base}/auth/xero/callback?code=x&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const cookie2 = extractCookie(res.headers.get('set-cookie'));

    // Upload + resolve + start, all through real HTTP.
    const N = 150;
    const rows = [['Class']];
    for (let i = 1; i <= N; i++) rows.push([`OPT${i}`]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S1');
    XLSX.writeFile(wb, 'test/http150.xlsx');

    const form = new FormData();
    const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    form.append('file', new Blob([fs.readFileSync('test/http150.xlsx')], { type: mimeType }), 'http150.xlsx');
    res = await fetch(`${base}/api/tracking/import/validate`, { method: 'POST', headers: { Cookie: cookie2 }, body: form });
    const preflight = await res.json();

    res = await fetch(`${base}/api/tracking/import/start`, {
      method: 'POST', headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadToken: preflight.uploadToken }),
    });
    const { jobs } = await res.json();
    const importId = jobs[0].importId;
    console.log('Started', importId, 'via real HTTP');

    let observedMidFlightProgress = false;
    let cacheHeaderOk = false;
    let finalStatus = null;

    for (let i = 0; i < 200; i++) {
      res = await fetch(`${base}/api/tracking/import/${importId}/status`, { headers: { Cookie: cookie2 } });
      cacheHeaderOk = cacheHeaderOk || res.headers.get('cache-control') === 'no-store';
      const status = await res.json();
      if (status.status === 'PROCESSING' && status.successfulOptions > 0 && status.successfulOptions < N) {
        observedMidFlightProgress = true;
        console.log(`mid-flight via HTTP: ${status.successfulOptions}/${N}, batch ${status.completedBatches}/${status.totalBatches}`);
      }
      if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(status.status)) { finalStatus = status; break; }
      await new Promise((r) => setTimeout(r, 150));
    }

    if (!observedMidFlightProgress) throw new Error('FAIL: never observed live mid-flight progress over real HTTP');
    if (!cacheHeaderOk) throw new Error('FAIL: Cache-Control: no-store header missing from /status response');
    if (!finalStatus || finalStatus.successfulOptions !== N) throw new Error('FAIL: did not reach expected final count');

    fs.unlinkSync('test/http150.xlsx');
    console.log('\nALL ASSERTIONS PASSED - live progress + no-store header verified over real HTTP');
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
