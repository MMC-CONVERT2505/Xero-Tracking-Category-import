// Regression test for the live-progress bug: polls the SAME getStatus()
// the frontend polls, WHILE the (real, unmocked) trackingBatchService is
// still processing - not after it finishes. Only xeroClient's network
// calls are stubbed; queue/retry/rate-limiter/batch logic is untouched.
process.env.XERO_MAX_REQUESTS_PER_MINUTE = '100000'; // don't wait on the real 60/min limiter for this test
process.env.XERO_MAX_CONCURRENT_REQUESTS = '5';
process.env.BATCH_SIZE = '50';

const Module = require('module');
const origLoad = Module._load;
let fakeCategories = [{ TrackingCategoryID: 'CAT-1', Name: 'Class', Status: 'ACTIVE', Options: [] }];

Module._load = function (request, parent, isMain) {
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (tenantId, id) => fakeCategories.find(c => c.TrackingCategoryID === id),
      createTrackingCategory: async () => { throw new Error('should not be called - category already exists'); },
      createTrackingOption: async (tenantId, categoryId, name) => {
        await new Promise((r) => setTimeout(r, 15)); // simulate real network latency per option
        const opt = { TrackingOptionID: `OPT-${Math.random()}`, Name: name, Status: 'ACTIVE' };
        fakeCategories.find(c => c.TrackingCategoryID === categoryId).Options.push(opt);
        return { Options: [opt] };
      },
    };
  }
  return origLoad.apply(this, arguments);
};

async function main() {
  const trackingImportService = require('../src/services/trackingImportService');
  const XLSX = require('xlsx');
  const fs = require('fs');

  const N = 150;
  const rows = [['Class']];
  for (let i = 1; i <= N; i++) rows.push([`OPT${String(i).padStart(4, '0')}`]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S1');
  XLSX.writeFile(wb, 'test/progress150.xlsx');

  const preflight = await trackingImportService.validateUpload('T1', fs.readFileSync('test/progress150.xlsx'), 'progress150.xlsx');
  const { jobs } = await trackingImportService.startImport('T1', preflight.uploadToken);
  const importId = jobs[0].importId;
  console.log(`Started ${importId} (${N} options, expect 3 batches of 50)`);

  // Poll exactly like the frontend does (every ~150ms here, to catch mid-flight
  // state quickly in a test) and log every DISTINCT successfulOptions value seen.
  const observedCounts = [];
  let finalStatus = null;
  for (let i = 0; i < 200; i++) {
    const status = await trackingImportService.getStatus(importId);
    const last = observedCounts[observedCounts.length - 1];
    if (last === undefined || last.successful !== status.successfulOptions || last.batch !== status.completedBatches) {
      observedCounts.push({ successful: status.successfulOptions, failed: status.failedOptions, pending: status.pendingOptions, batch: status.completedBatches, jobStatus: status.status });
      console.log(`t=${i}: successful=${status.successfulOptions} failed=${status.failedOptions} pending=${status.pendingOptions} completedBatches=${status.completedBatches}/${status.totalBatches} status=${status.status}`);
    }
    if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(status.status)) { finalStatus = status; break; }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!finalStatus) throw new Error('FAIL: import never reached a terminal state within the test window');

  // THE regression assertion: we must have observed successfulOptions
  // taking on intermediate values (not just 0 then 150) WHILE the job was
  // still PROCESSING - proving progress was visible mid-import, not only
  // after completion.
  const midFlightNonZero = observedCounts.some((c) => c.jobStatus === 'PROCESSING' && c.successful > 0 && c.successful < N);
  console.log('\nDistinct progress snapshots observed:', observedCounts.length);
  if (!midFlightNonZero) {
    throw new Error('FAIL: never observed a non-zero, non-final successfulOptions value while status===PROCESSING - live progress is broken');
  }
  if (finalStatus.successfulOptions !== N) throw new Error(`FAIL: expected ${N} successful at the end, got ${finalStatus.successfulOptions}`);
  if (finalStatus.successfulOptions + finalStatus.failedOptions + finalStatus.pendingOptions !== N) {
    throw new Error('FAIL: successful+failed+pending does not equal total');
  }

  fs.unlinkSync('test/progress150.xlsx');
  console.log('\nALL ASSERTIONS PASSED - live progress is visible mid-import via GET /status');
}

main().catch((e) => { console.error(e); process.exit(1); });
