// Proves the new GET /api/tracking/import/batch/:batchId route is
// correctly reachable and NOT swallowed by GET /api/tracking/import/:importId
// (a classic Express route-ordering mistake - "batch" would otherwise be
// captured as an importId value). Exercises the full real HTTP stack:
// OAuth session, multipart upload, resolve-category, start, batch status.
process.env.XERO_CLIENT_ID = 'fake';
process.env.XERO_CLIENT_SECRET = 'fake';
process.env.XERO_MAX_REQUESTS_PER_MINUTE = '100000';

const Module = require('module');
const origLoad = Module._load;
let fakeCategories = [];

Module._load = function (request, parent, isMain) {
  if (request === './xeroAuthService' || request === '../services/xeroAuthService') {
    return {
      getAuthorizeUrl: (s) => `https://login.xero.com/identity/connect/authorize?state=${s}`,
      exchangeCodeForToken: async () => ({ access_token: 't', refresh_token: 'r', expires_in: 1800, obtainedAt: Date.now() }),
      refreshTokenRaw: async () => ({ access_token: 't2', refresh_token: 'r2', expires_in: 1800, obtainedAt: Date.now() }),
      fetchConnections: async () => ([{ id: 'c1', tenantId: 'T1', tenantName: 'Test Co', tenantType: 'ORGANISATION' }]),
    };
  }
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (t, id) => fakeCategories.find((c) => c.TrackingCategoryID === id),
      createTrackingCategory: async (t, name) => {
        const cat = { TrackingCategoryID: `CAT-${name}`, Name: name, Status: 'ACTIVE', Options: [] };
        fakeCategories.push(cat);
        return cat;
      },
      createTrackingOption: async (t, categoryId, name) => {
        const opt = { TrackingOptionID: `OPT-${name}`, Name: name, Status: 'ACTIVE' };
        fakeCategories.find((c) => c.TrackingCategoryID === categoryId).Options.push(opt);
        return { Options: [opt] };
      },
    };
  }
  return origLoad.apply(this, arguments);
};

async function main() {
  const app = require('../src/app');
  const XLSX = require('xlsx');
  const fs = require('fs');
  const server = app.listen(4096);
  const base = 'http://localhost:4096';

  try {
    let res = await fetch(`${base}/auth/xero`, { redirect: 'manual' });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const state = new URL(res.headers.get('location')).searchParams.get('state');
    res = await fetch(`${base}/auth/xero/callback?code=x&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const cookie2 = res.headers.get('set-cookie').split(';')[0];

    const rows = [['Class', 'Department'], ['A', 'X'], ['B', 'Y']];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S1');
    XLSX.writeFile(wb, 'test/httpbatch.xlsx');

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync('test/httpbatch.xlsx')], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'httpbatch.xlsx');
    res = await fetch(`${base}/api/tracking/import/validate`, { method: 'POST', headers: { Cookie: cookie2 }, body: form });
    const preflight = await res.json();
    const classKey = preflight.categories.find((c) => c.categoryNameInFile === 'Class').key;
    const deptKey = preflight.categories.find((c) => c.categoryNameInFile === 'Department').key;

    await fetch(`${base}/api/tracking/import/resolve-category`, { method: 'POST', headers: { Cookie: cookie2, 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadToken: preflight.uploadToken, key: classKey }) });
    await fetch(`${base}/api/tracking/import/resolve-category`, { method: 'POST', headers: { Cookie: cookie2, 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadToken: preflight.uploadToken, key: deptKey }) });

    res = await fetch(`${base}/api/tracking/import/start`, { method: 'POST', headers: { Cookie: cookie2, 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadToken: preflight.uploadToken }) });
    const { batchId, jobs } = await res.json();
    console.log('batchId:', batchId, '| jobs:', jobs.length);

    // THE key assertion: GET /api/tracking/import/batch/:batchId must hit
    // the batch aggregate, not fall through to the single-job :importId route.
    for (let i = 0; i < 20; i++) {
      res = await fetch(`${base}/api/tracking/import/batch/${batchId}`, { headers: { Cookie: cookie2 } });
      const body = await res.json();
      if (res.status !== 200) throw new Error(`FAIL: batch route returned ${res.status}: ${JSON.stringify(body)}`);
      if (!Array.isArray(body.categories)) throw new Error(`FAIL: response doesn't look like a batch aggregate (got single-job shape?): ${JSON.stringify(body)}`);
      if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(body.status)) {
        console.log('Final batch response:', JSON.stringify(body, null, 2));
        if (body.categoriesCount !== 2) throw new Error(`FAIL: expected 2 categories, got ${body.categoriesCount}`);
        console.log('\nGET /api/tracking/import/batch/:batchId correctly reached the aggregate route (not swallowed by /:importId).');
        console.log('ALL ASSERTIONS PASSED');
        fs.unlinkSync('test/httpbatch.xlsx');
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('FAIL: batch never reached a terminal state');
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
