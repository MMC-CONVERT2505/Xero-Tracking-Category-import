// Task 1-5 regression test: real Xero error shapes must produce real
// messages (not Axios' generic "Request failed with status code 500" /
// "A validation exception occurred"), retryability must stay unchanged
// (500 retryable, 400 validation permanent), and no token/secret may ever
// appear in the structured log or persisted result.
process.env.MAX_RETRIES = '2'; // keep the test fast
const FAKE_TOKEN = 'SUPER-SECRET-ACCESS-TOKEN-abc123xyz789';

const Module = require('module');
const origLoad = Module._load;
let fakeCategories = [{ TrackingCategoryID: 'CAT-1', Name: 'Class', Status: 'ACTIVE', Options: [] }];

function makeAxiosErr({ status, data, headers = {} }) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data, headers };
  // Exactly what a real Axios error carries - including the Authorization
  // header on the ORIGINAL request config. The parser/logger must never
  // read this. If it ever leaked, this test's grep below would catch it.
  err.config = { headers: { Authorization: `Bearer ${FAKE_TOKEN}`, 'xero-tenant-id': 'T1' } };
  return err;
}

Module._load = function (request, parent, isMain) {
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (t, id) => fakeCategories.find(c => c.TrackingCategoryID === id),
      createTrackingCategory: async () => { throw new Error('not used'); },
      createTrackingOption: async (t, categoryId, name) => {
        if (name === 'TOOLONGNAME00001') {
          // Real Xero ValidationException shape.
          throw makeAxiosErr({
            status: 400,
            data: {
              ErrorNumber: 10,
              Type: 'ValidationException',
              Message: 'A validation exception occurred',
              Elements: [{ ValidationErrors: [{ Message: 'The Name field must be 100 characters or fewer.' }] }],
            },
          });
        }
        if (name === 'GATEWAY50000001') {
          // Gateway-level 500 with an HTML body, not Xero JSON at all.
          throw makeAxiosErr({ status: 500, data: '<html><body>502 Bad Gateway</body></html>' });
        }
        const opt = { TrackingOptionID: `OPT-${Math.random()}`, Name: name, Status: 'ACTIVE' };
        fakeCategories.find(c => c.TrackingCategoryID === categoryId).Options.push(opt);
        return { Options: [opt] };
      },
    };
  }
  return origLoad.apply(this, arguments);
};

async function waitTerminal(svc, importId) {
  let status;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 150));
    status = await svc.getStatus(importId);
    if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(status.status)) break;
  }
  return status;
}

async function main() {
  const trackingImportService = require('../src/services/trackingImportService');
  const XLSX = require('xlsx');
  const fs = require('fs');

  // Capture console.error output to prove the token never appears in it.
  const loggedLines = [];
  const origConsoleError = console.error;
  console.error = (...args) => { loggedLines.push(args.map(String).join(' ')); origConsoleError(...args); };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Class'], ['GOODOPTION001'], ['TOOLONGNAME00001'], ['GATEWAY50000001'],
  ]), 'S1');
  XLSX.writeFile(wb, 'test/errdetail.xlsx');
  const buf = fs.readFileSync('test/errdetail.xlsx');

  const preflight = await trackingImportService.validateUpload('T1', buf, 'errdetail.xlsx');
  const { jobs } = await trackingImportService.startImport('T1', preflight.uploadToken);
  const importId = jobs[0].importId;
  const status = await waitTerminal(trackingImportService, importId);
  console.log = console.log; // no-op, just keeping eslint happy
  origConsoleError.call(console, 'final status:', status.status, '| success:', status.successfulOptions, '| failed:', status.failedOptions);

  const report = await trackingImportService.getErrorReport(importId);
  console.error = origConsoleError;

  const validationEntry = report.find((r) => r.optionName === 'TOOLONGNAME00001');
  const gatewayEntry = report.find((r) => r.optionName === 'GATEWAY50000001');
  console.log('\n--- error report ---');
  console.log(JSON.stringify(report, null, 2));

  // Task 2: real validation message, not the generic wrapper string.
  if (validationEntry.xeroError !== 'The Name field must be 100 characters or fewer.') {
    throw new Error(`FAIL: expected the real validation message, got "${validationEntry.xeroError}"`);
  }
  if (validationEntry.xeroError === 'A validation exception occurred') {
    throw new Error('FAIL: still showing the generic Xero wrapper message, not the field-level detail');
  }
  if (validationEntry.permanent !== true) throw new Error('FAIL: validation error must be permanent (Task 4)');
  if (validationEntry.attempts !== 1) throw new Error(`FAIL: a permanent error must not be retried - expected 1 attempt, got ${validationEntry.attempts}`);

  // Task 1: a meaningful message for the 500, not Axios' generic string.
  if (gatewayEntry.xeroError.includes('Request failed with status code')) {
    throw new Error(`FAIL: still showing Axios' generic message: "${gatewayEntry.xeroError}"`);
  }
  if (!gatewayEntry.xeroError.includes('Bad Gateway') || !gatewayEntry.xeroError.includes('500')) {
    throw new Error(`FAIL: expected the real response body snippet to appear, got "${gatewayEntry.xeroError}"`);
  }
  if (gatewayEntry.permanent !== false) throw new Error('FAIL: a 500 must remain retryable (Task 4)');
  if (gatewayEntry.attempts !== 3) throw new Error(`FAIL: expected MAX_RETRIES(2)+1=3 attempts for a persistently-failing 500, got ${gatewayEntry.attempts}`);

  // Successful option must be unaffected.
  if (status.successfulOptions !== 1) throw new Error(`FAIL: expected 1 successful option, got ${status.successfulOptions}`);

  // CRITICAL security check: the fake token must never appear anywhere in
  // the structured log output or the persisted/report data.
  const reportText = JSON.stringify(report);
  const logsText = loggedLines.join('\n');
  if (reportText.includes(FAKE_TOKEN) || reportText.toLowerCase().includes('bearer')) {
    throw new Error('FAIL: SECURITY - token/Authorization leaked into the error report');
  }
  if (logsText.includes(FAKE_TOKEN) || logsText.toLowerCase().includes('bearer')) {
    throw new Error('FAIL: SECURITY - token/Authorization leaked into the structured logs');
  }
  console.log('\nSecurity check passed: token never appears in report or logs.');

  // Confirm the structured log line shape (Task 5) was actually emitted.
  const structuredLine = loggedLines.find((l) => l.includes('[IMPORT_ERROR]') && l.includes('TOOLONGNAME00001'));
  if (!structuredLine) throw new Error('FAIL: structured [IMPORT_ERROR] log line not found');
  console.log('Structured log line found:', structuredLine);

  fs.unlinkSync('test/errdetail.xlsx');
  console.log('\nALL ASSERTIONS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
