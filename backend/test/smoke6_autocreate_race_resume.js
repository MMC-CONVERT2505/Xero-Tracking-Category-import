// Test 5: two simultaneous resolveCategory() calls for the SAME new
// category name must result in exactly ONE Xero category being created.
// Test 6: category creation succeeds, then an option import fails
// partway -> retryFailed() resumes using the SAME persisted category ID.
// Test 7: category was created and cached to disk; a fresh require of the
// service (simulating a server restart, since the cache lives in
// backend/data/*.json, not in memory) still resolves to the same ID
// without re-creating it.
const Module = require('module');
const origLoad = Module._load;

let fakeCategories = [];
let categorySeq = 0;
let createCategoryCallCount = 0;
let createCategoryDelayMs = 40; // simulate real network latency so both racers are genuinely "in flight" together
let failOptionPermanently = new Set(); // option names that fail with a non-retryable 400 until removed from this set

Module._load = function (request, parent, isMain) {
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (tenantId, id) => fakeCategories.find(c => c.TrackingCategoryID === id),
      createTrackingCategory: async (tenantId, name) => {
        createCategoryCallCount += 1;
        await new Promise((r) => setTimeout(r, createCategoryDelayMs));
        categorySeq += 1;
        const cat = { TrackingCategoryID: `CAT-RACE-${categorySeq}`, Name: name, Status: 'ACTIVE', Options: [] };
        fakeCategories.push(cat);
        return cat;
      },
      createTrackingOption: async (tenantId, categoryId, name) => {
        if (failOptionPermanently.has(name)) {
          const e = new Error('Invalid option name');
          e.response = { status: 400, data: { Message: 'Invalid option name' } }; // permanent - never auto-retried
          throw e;
        }
        const opt = { TrackingOptionID: `OPT-${Math.random().toString(36).slice(2)}`, Name: name, Status: 'ACTIVE' };
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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Class'], ['A'], ['B'], ['C']]), 'S1');
  XLSX.writeFile(wb, 'test/race.xlsx');
  const buf = fs.readFileSync('test/race.xlsx');

  console.log('=== Test 5: two concurrent imports, same tenant + category name ===');
  const [preflightA, preflightB] = await Promise.all([
    trackingImportService.validateUpload('T-RACE', buf, 'race.xlsx'),
    trackingImportService.validateUpload('T-RACE', buf, 'race.xlsx'),
  ]);
  const keyA = preflightA.categories[0].key;
  const keyB = preflightB.categories[0].key;

  // Fire both resolveCategory calls at the same instant - this is the
  // actual race: both see NOT_FOUND, both call resolveOrCreateCategory,
  // and only the categoryLockService mutex should let one through to
  // actually create while the other reuses what the first one made.
  const [resolvedA, resolvedB] = await Promise.all([
    trackingImportService.resolveCategory('T-RACE', preflightA.uploadToken, keyA),
    trackingImportService.resolveCategory('T-RACE', preflightB.uploadToken, keyB),
  ]);
  console.log('Job A resolved to:', resolvedA.trackingCategoryId, '| Job B resolved to:', resolvedB.trackingCategoryId);
  console.log('createTrackingCategory was called', createCategoryCallCount, 'time(s)');
  if (createCategoryCallCount !== 1) throw new Error(`FAIL: expected createTrackingCategory called exactly once, got ${createCategoryCallCount}`);
  if (resolvedA.trackingCategoryId !== resolvedB.trackingCategoryId) throw new Error('FAIL: the two concurrent jobs resolved to DIFFERENT category ids');
  console.log('Test 5 PASSED - only one category created under concurrent load');

  console.log('=== Test 6: category created OK, one option fails PERMANENTLY, then is fixed and retryFailed() resumes with SAME category id ===');
  failOptionPermanently.add('B'); // "B" will be rejected by Xero (400) until we "fix" it below
  const { jobs } = await trackingImportService.startImport('T-RACE', preflightA.uploadToken);
  let status = await waitTerminal(trackingImportService, jobs[0].importId);
  console.log('after first pass:', status.status, '| success:', status.successfulOptions, '| failed:', status.failedOptions, '| categoryId:', status.trackingCategoryId);
  if (status.failedOptions !== 1) throw new Error('FAIL: expected exactly 1 failed option ("B") after the first pass');
  const categoryIdBeforeRetry = status.trackingCategoryId;

  failOptionPermanently.delete('B'); // simulate whatever was wrong with "B" now being fixed
  const resumed = await trackingImportService.retryFailed(jobs[0].importId);
  console.log('after retryFailed:', resumed.status, '| success:', resumed.successfulOptions, '| categoryId:', resumed.trackingCategoryId);
  if (resumed.status !== 'SUCCESS') throw new Error('FAIL: retryFailed should have reached SUCCESS');
  if (resumed.trackingCategoryId !== categoryIdBeforeRetry) throw new Error('FAIL: retryFailed used a DIFFERENT category id than the original job');
  console.log('Test 6 PASSED - resumed with the same persisted TrackingCategoryID');

  console.log('=== Test 7: persisted cache survives a fresh require (simulated restart) ===');
  // The category id cache lives in backend/data/categoryLocks.json (via
  // db/store.js), not in any in-memory Map, so clearing node's require
  // cache and re-requiring the service is an honest simulation of a
  // process restart for this specific mechanism.
  delete require.cache[require.resolve('../src/services/trackingImportService')];
  delete require.cache[require.resolve('../src/services/trackingCategoryService')];
  delete require.cache[require.resolve('../src/db/store')];
  const freshService = require('../src/services/trackingImportService');

  const preflightC = await freshService.validateUpload('T-RACE', buf, 'race.xlsx');
  const resolvedC = await freshService.resolveCategory('T-RACE', preflightC.uploadToken, preflightC.categories[0].key);
  console.log('after "restart", resolved to:', resolvedC.trackingCategoryId, '(should match', categoryIdBeforeRetry, ')');
  if (resolvedC.trackingCategoryId !== categoryIdBeforeRetry) throw new Error('FAIL: after "restart", a NEW category was created instead of reusing the persisted one');
  if (createCategoryCallCount !== 1) throw new Error(`FAIL: createTrackingCategory should still only have been called once total, got ${createCategoryCallCount}`);
  console.log('Test 7 PASSED - "restart" reused the persisted TrackingCategoryID, no duplicate created');

  fs.unlinkSync('test/race.xlsx');
  console.log('ALL ASSERTIONS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
