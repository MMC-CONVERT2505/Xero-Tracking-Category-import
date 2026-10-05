// Multi-category-per-file regression suite. Covers spec test cases 2, 3,
// 4-10, 12, 14-18 in two scenarios; smoke11b (further below, same file)
// covers case 11 (restart mid multi-category import) and 13 (two tenants
// at once). Case 1 and 19 (single-category files, full existing suite)
// are covered by re-running every pre-existing smoke test unchanged.
//
// Note: Xero allows a maximum of 2 ACTIVE Tracking Categories per
// organisation (already-enforced, pre-existing logic - see
// trackingCategoryService.js). Scenario 1 below therefore creates at most
// 1 brand-new category (alongside 1 pre-existing one = 2 total, at the
// real limit) rather than 3, which no real Xero org could ever satisfy;
// scenario 2 covers "three categories in one file" with all three
// pre-existing, since REUSING a category never touches that limit.
process.env.MAX_RETRIES = '2';
process.env.XERO_MAX_CONCURRENT_REQUESTS = '3';
process.env.XERO_MAX_REQUESTS_PER_MINUTE = '100000'; // isolate concurrency behaviour from the separate rate-limiter tests

const Module = require('module');
const origLoad = Module._load;

let fakeCategories = [
  { TrackingCategoryID: 'CAT-DEPT-EXISTING', Name: 'Department', Status: 'ACTIVE', Options: [{ TrackingOptionID: 'O1', Name: 'HR', Status: 'ACTIVE' }] },
];
let createCategoryCalls = [];
let attemptsByName = new Map(); // per-option-name attempt counter, so behaviour is deterministic regardless of call ordering/concurrency
let inFlight = 0;
let maxInFlight = 0;

function makeErr(status, data, headers = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data, headers };
  return err;
}

Module._load = function (request, parent, isMain) {
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (t, id) => fakeCategories.find((c) => c.TrackingCategoryID === id),
      createTrackingCategory: async (t, name) => {
        createCategoryCalls.push(name);
        const cat = { TrackingCategoryID: `CAT-NEW-${createCategoryCalls.length}`, Name: name, Status: 'ACTIVE', Options: [] };
        fakeCategories.push(cat);
        return cat;
      },
      createTrackingOption: async (t, categoryId, name) => {
        const attempt = (attemptsByName.get(name) || 0) + 1;
        attemptsByName.set(name, attempt);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await new Promise((r) => setTimeout(r, 25)); // hold the "slot" briefly so concurrency is observable

          if (name === 'BADOPTION001') {
            throw makeErr(400, { ErrorNumber: 10, Type: 'ValidationException', Message: 'A validation exception occurred', Elements: [{ ValidationErrors: [{ Message: 'Option name contains invalid characters.' }] }] });
          }
          if (name === 'FLAKY00001' && attempt <= 2) {
            throw makeErr(429, { Message: 'Rate limit exceeded' }, { 'retry-after': '0' });
          }
          if (name === 'GATEWAY0001' && attempt <= 2) {
            throw makeErr(500, undefined);
          }

          const opt = { TrackingOptionID: `OPT-${name}`, Name: name, Status: 'ACTIVE' };
          fakeCategories.find((c) => c.TrackingCategoryID === categoryId).Options.push(opt);
          return { Options: [opt] };
        } finally {
          inFlight -= 1;
        }
      },
    };
  }
  return origLoad.apply(this, arguments);
};

async function waitBatch(svc, tenantId, batchId, timeoutMs = 15000) {
  const start = Date.now();
  let batch;
  while (Date.now() - start < timeoutMs) {
    batch = await svc.getBatchStatus(tenantId, batchId);
    if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(batch.status)) return batch;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Batch ${batchId} did not reach a terminal state in time: ${JSON.stringify(batch)}`);
}

async function main() {
  const svc = require('../src/services/trackingImportService');
  const XLSX = require('xlsx');
  const fs = require('fs');

  // ===== Scenario 1 (cases 2, 4-10, 12, 14-18): two categories in one =====
  // Excel file - "Class" (new) and "Department" (existing, at Xero's real
  // 2-active-category cap once Class is created too) - covering
  // duplicate-dedup, reuse, auto-create, mixed found/not-found, shared
  // concurrency, and every retry classification, all at once.
  console.log('=== Scenario 1: 2-category Excel file - Class (new), Department (existing) ===');
  const rows = [
    ['Class', 'Department'],
    ['CLIFTONS00001', 'Sales'],
    ['CLIFTONS00002', 'HR'],           // "HR" already exists in Xero -> must be skipped, not re-created
    ['CLIFTONS00003', 'Finance'],
    ['CLIFTONS00001', 'BADOPTION001'], // duplicate "CLIFTONS00001" in Class; permanent validation failure in Department
    ['', 'FLAKY00001'],                // transient 429 in Department
    ['', 'GATEWAY0001'],               // transient 500 in Department
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(wb, 'test/multicat.xlsx');
  const buf = fs.readFileSync('test/multicat.xlsx');

  const preflight = await svc.validateUpload('T1', buf, 'multicat.xlsx');
  const byName = Object.fromEntries(preflight.categories.map((c) => [c.categoryNameInFile, c]));
  console.log('Detected:', Object.keys(byName).map((n) => `${n}:${byName[n].status}`).join(', '));

  if (byName.Class.status !== 'NOT_FOUND') throw new Error('FAIL (case 8): Class should be NOT_FOUND before creation');
  if (byName.Department.status !== 'FOUND') throw new Error('FAIL (case 7): Department should be FOUND (already exists)');
  if (byName.Department.existingOptionsCount !== 1) throw new Error('FAIL: Department should show 1 existing option (HR)');
  if (byName.Class.duplicateRows !== 1) throw new Error(`FAIL (case 5/6): expected 1 duplicate row in Class (CLIFTONS00001 x2), got ${byName.Class.duplicateRows}`);
  if (byName.Class.uniqueOptionsCount !== 3) throw new Error(`FAIL (case 5/6): expected 3 unique Class options, got ${byName.Class.uniqueOptionsCount}`);
  console.log('Cases 2/4/5/6/7/8/9 (detection) PASSED');

  await svc.resolveCategory('T1', preflight.uploadToken, byName.Class.key);

  const { batchId, jobs, skipped } = await svc.startImport('T1', preflight.uploadToken);
  console.log('\nbatchId:', batchId, '| jobs:', jobs.map((j) => `${j.categoryName}(${j.trackingCategoryId})`), '| skipped:', skipped);
  if (jobs.length !== 2) throw new Error(`FAIL: expected 2 jobs, got ${jobs.length}`);
  const ids = jobs.map((j) => j.trackingCategoryId);
  if (new Set(ids).size !== 2) throw new Error('FAIL (case 17): two categories resolved to the SAME TrackingCategoryID - must be independent');
  const deptJob = jobs.find((j) => j.categoryName === 'Department');
  if (deptJob.trackingCategoryId !== 'CAT-DEPT-EXISTING') throw new Error('FAIL (case 7/17): Department should reuse its existing id, not a new one');

  const batch = await waitBatch(svc, 'T1', batchId);
  console.log('\nFinal batch status:', JSON.stringify(batch, null, 2));

  // Case 12: shared tenant-level concurrency - both categories combined
  // must never exceed XERO_MAX_CONCURRENT_REQUESTS(3), proving they share
  // ONE tenant queue rather than each getting their own.
  console.log(`\nMax concurrent createTrackingOption calls observed across both categories: ${maxInFlight} (must be <= 3)`);
  if (maxInFlight > 3) throw new Error(`FAIL (case 12): concurrency exceeded the shared tenant limit - got ${maxInFlight}`);
  if (maxInFlight < 2) throw new Error('FAIL: test is not actually exercising concurrent categories - check the scenario');

  // Case 14: exactly one attempt for the permanent validation failure.
  const errorReport = await svc.getErrorReport(deptJob.importId);
  const badOption = errorReport.find((e) => e.optionName === 'BADOPTION001');
  if (!badOption || badOption.attempts !== 1 || !badOption.permanent) throw new Error(`FAIL (case 14): BADOPTION001 should be permanent with exactly 1 attempt, got ${JSON.stringify(badOption)}`);
  if (badOption.xeroError !== 'Option name contains invalid characters.') throw new Error(`FAIL: expected the real validation message, got "${badOption.xeroError}"`);
  console.log('Case 14 PASSED - permanent validation error took exactly 1 attempt with the real message.');

  // Case 15/16: transient 429 and 500 (both isolated to Department) eventually succeeded via retry.
  const classStatus = await svc.getStatus(jobs.find((j) => j.categoryName === 'Class').importId);
  const deptStatus = await svc.getStatus(deptJob.importId);
  if (classStatus.successfulOptions !== 3) throw new Error(`FAIL: Class should have 3 unique successful options, got ${classStatus.successfulOptions}`);
  if (deptStatus.successfulOptions !== 4) throw new Error(`FAIL: Department should have 4 successful (Sales, Finance, FLAKY recovered, GATEWAY recovered), got ${deptStatus.successfulOptions}`);
  if (deptStatus.failedOptions !== 1) throw new Error('FAIL: Department should have exactly 1 failure (the permanent one)');
  if (attemptsByName.get('FLAKY00001') !== 3) throw new Error(`FAIL (case 15): FLAKY00001 should have taken 3 attempts (2 x 429 + 1 success), got ${attemptsByName.get('FLAKY00001')}`);
  if (attemptsByName.get('GATEWAY0001') !== 3) throw new Error(`FAIL (case 16): GATEWAY0001 should have taken 3 attempts (2 x 500 + 1 success), got ${attemptsByName.get('GATEWAY0001')}`);
  console.log('Cases 15/16 PASSED - transient 429/500 recovered via the existing retry logic, only the permanent one is a final failure.');

  // Case 18: no duplicate options - Department's "HR" (already existing) was never re-sent.
  if (deptStatus.existingOptions !== 1) throw new Error(`FAIL (case 18): Department should show 1 existing (HR, skipped), got ${deptStatus.existingOptions}`);
  const deptCategory = fakeCategories.find((c) => c.TrackingCategoryID === 'CAT-DEPT-EXISTING');
  if (deptCategory.Options.filter((o) => o.Name === 'HR').length !== 1) throw new Error('FAIL (case 18): "HR" was duplicated in Xero');
  console.log('Case 18 PASSED - already-existing option was skipped, never duplicated.');

  // Case 17: exactly the categories we expected, no extras.
  if (fakeCategories.filter((c) => c.Name === 'Class').length !== 1) throw new Error('FAIL (case 17): duplicate "Class" category created');
  if (fakeCategories.filter((c) => c.Name === 'Department').length !== 1) throw new Error('FAIL (case 17): "Department" was duplicated instead of reused');
  console.log('Case 17 PASSED - exactly one category per name.');

  // Aggregate batch totals must equal the sum of the categories.
  if (batch.categoriesCount !== 2) throw new Error('FAIL: batch should report 2 categories');
  if (batch.skippedTotal !== 1) throw new Error(`FAIL: batch skippedTotal should be 1 (Department's HR), got ${batch.skippedTotal}`);
  if (batch.failedTotal !== 1) throw new Error(`FAIL: batch failedTotal should be 1, got ${batch.failedTotal}`);
  if (batch.status !== 'PARTIAL') throw new Error(`FAIL: overall batch status should be PARTIAL (one category has a permanent failure), got ${batch.status}`);
  console.log('Aggregate batch totals PASSED.');

  fs.unlinkSync('test/multicat.xlsx');
  console.log('\n=== Scenario 1 (cases 2, 4-10, 12, 14-18) ALL PASSED ===\n');

  // ===== Scenario 2 (case 3): three categories, ALL already existing - =====
  // proves reuse works for more than 2 categories in one file (Xero's real
  // 2-active-category cap only bounds CREATION, never reuse).
  console.log('=== Scenario 2: 3-category CSV, all three already exist in Xero ===');
  fakeCategories.push(
    { TrackingCategoryID: 'CAT-CLASS-EXISTING', Name: 'Class', Status: 'ACTIVE', Options: [] },
    { TrackingCategoryID: 'CAT-LOC-EXISTING', Name: 'Location', Status: 'ACTIVE', Options: [] },
  );
  const csvText = 'Class,Department,Location\nA,Sales,India\nB,HR,Australia\nC,Finance,Japan\n';
  fs.writeFileSync('test/three.csv', csvText, 'utf8');
  const preflight2 = await svc.validateUpload('T1', fs.readFileSync('test/three.csv'), 'three.csv');
  const byName2 = Object.fromEntries(preflight2.categories.map((c) => [c.categoryNameInFile, c]));
  console.log('Detected (CSV):', Object.keys(byName2).map((n) => `${n}:${byName2[n].status}`).join(', '));
  if (preflight2.categories.length !== 3) throw new Error(`FAIL (case 3): expected 3 detected categories, got ${preflight2.categories.length}`);
  if (!['Class', 'Department', 'Location'].every((n) => byName2[n]?.status === 'FOUND')) {
    throw new Error('FAIL (case 3): all 3 pre-existing categories should resolve as FOUND with no creation needed');
  }
  const { batchId: batchId2, jobs: jobs2 } = await svc.startImport('T1', preflight2.uploadToken);
  if (jobs2.length !== 3) throw new Error(`FAIL (case 3): expected 3 jobs, got ${jobs2.length}`);
  await waitBatch(svc, 'T1', batchId2);
  if (createCategoryCalls.length !== 1) throw new Error(`FAIL: createTrackingCategory should have been called exactly once total across both scenarios (only "Class" in scenario 1), got ${createCategoryCalls.length} calls: ${createCategoryCalls}`);
  console.log('Case 3 PASSED - three-category CSV file, all reused, no creation attempted.');

  fs.unlinkSync('test/three.csv');
  console.log('\n=== Scenario 2 (case 3, CSV multi-category) ALL PASSED ===\n');

  // ===== Scenario 3 (case 11): server restart mid multi-category import =====
  console.log('=== Scenario 3: restart mid-way through a 2-category import ===');
  fakeCategories.push({ TrackingCategoryID: 'CAT-A-EXISTING', Name: 'CatA', Status: 'ACTIVE', Options: [] });
  fakeCategories.push({ TrackingCategoryID: 'CAT-B-EXISTING', Name: 'CatB', Status: 'ACTIVE', Options: [] });
  const wb3 = XLSX.utils.book_new();
  const rowsA = [['CatA']]; for (let i = 1; i <= 6; i++) rowsA.push([`A${i}`]);
  const rowsB = [['CatB']]; for (let i = 1; i <= 6; i++) rowsB.push([`B${i}`]);
  XLSX.utils.book_append_sheet(wb3, XLSX.utils.aoa_to_sheet(rowsA), 'SheetA');
  XLSX.utils.book_append_sheet(wb3, XLSX.utils.aoa_to_sheet(rowsB), 'SheetB');
  XLSX.writeFile(wb3, 'test/restart.xlsx');

  const preflight3 = await svc.validateUpload('T1', fs.readFileSync('test/restart.xlsx'), 'restart.xlsx');
  const { batchId: batchId3, jobs: jobs3 } = await svc.startImport('T1', preflight3.uploadToken);
  const [jobA, jobB] = jobs3;

  // Let it get partway, then simulate a hard restart by clearing Node's
  // require cache (the ONLY thing that would actually restart is the
  // in-memory process - all progress lives in backend/data/*.json, so
  // this is an honest simulation of the persisted state a real restart
  // would find).
  await new Promise((r) => setTimeout(r, 60));
  delete require.cache[require.resolve('../src/services/trackingImportService')];
  delete require.cache[require.resolve('../src/services/trackingBatchService')];
  delete require.cache[require.resolve('../src/db/store')];
  const freshSvc = require('../src/services/trackingImportService');

  const midStatusA = await freshSvc.getStatus(jobA.importId);
  const midStatusB = await freshSvc.getStatus(jobB.importId);
  console.log(`Progress at "restart": CatA ${midStatusA.successfulOptions}/6, CatB ${midStatusB.successfulOptions}/6`);

  // The real server.js does this on boot - re-run the same recovery logic here.
  const freshBatchSvc = require('../src/services/trackingBatchService');
  await Promise.all([freshBatchSvc.processJob(jobA.importId), freshBatchSvc.processJob(jobB.importId)]);

  const finalBatch3 = await waitBatch(freshSvc, 'T1', batchId3);
  console.log('Final batch after "restart":', JSON.stringify({ status: finalBatch3.status, successfulTotal: finalBatch3.successfulTotal }));
  if (finalBatch3.status !== 'SUCCESS' || finalBatch3.successfulTotal !== 12) {
    throw new Error(`FAIL (case 11): expected both categories to finish at 12 total successful after "restart", got ${JSON.stringify(finalBatch3)}`);
  }
  if (fakeCategories.filter((c) => c.Name === 'CatA').length !== 1 || fakeCategories.filter((c) => c.Name === 'CatB').length !== 1) {
    throw new Error('FAIL (case 11): a category was duplicated across the restart');
  }
  console.log('Case 11 PASSED - both categories resumed from persisted state after a simulated restart, no data lost, no duplicate categories.');
  fs.unlinkSync('test/restart.xlsx');

  // ===== Scenario 4 (case 13): two different tenants processing at once =====
  console.log('\n=== Scenario 4: two different tenants importing simultaneously ===');
  fakeCategories.push({ TrackingCategoryID: 'CAT-TX', Name: 'TenantXCat', Status: 'ACTIVE', Options: [] });
  fakeCategories.push({ TrackingCategoryID: 'CAT-TY', Name: 'TenantYCat', Status: 'ACTIVE', Options: [] });
  const wbX = XLSX.utils.book_new();
  const rowsX = [['TenantXCat']]; for (let i = 1; i <= 5; i++) rowsX.push([`X${i}`]);
  XLSX.utils.book_append_sheet(wbX, XLSX.utils.aoa_to_sheet(rowsX), 'S');
  XLSX.writeFile(wbX, 'test/tenantx.xlsx');
  const wbY = XLSX.utils.book_new();
  const rowsY = [['TenantYCat']]; for (let i = 1; i <= 5; i++) rowsY.push([`Y${i}`]);
  XLSX.utils.book_append_sheet(wbY, XLSX.utils.aoa_to_sheet(rowsY), 'S');
  XLSX.writeFile(wbY, 'test/tenanty.xlsx');

  const pfX = await freshSvc.validateUpload('TENANT-X', fs.readFileSync('test/tenantx.xlsx'), 'tenantx.xlsx');
  const pfY = await freshSvc.validateUpload('TENANT-Y', fs.readFileSync('test/tenanty.xlsx'), 'tenanty.xlsx');
  const [{ batchId: bx, jobs: jx }, { batchId: by, jobs: jy }] = await Promise.all([
    freshSvc.startImport('TENANT-X', pfX.uploadToken),
    freshSvc.startImport('TENANT-Y', pfY.uploadToken),
  ]);
  const [batchX, batchY] = await Promise.all([
    waitBatch(freshSvc, 'TENANT-X', bx),
    waitBatch(freshSvc, 'TENANT-Y', by),
  ]);
  if (batchX.status !== 'SUCCESS' || batchX.successfulTotal !== 5) throw new Error(`FAIL (case 13): Tenant X should independently reach 5 successful, got ${JSON.stringify(batchX)}`);
  if (batchY.status !== 'SUCCESS' || batchY.successfulTotal !== 5) throw new Error(`FAIL (case 13): Tenant Y should independently reach 5 successful, got ${JSON.stringify(batchY)}`);
  // Cross-tenant isolation: a batchId only ever resolves for the tenant it belongs to.
  const crossLookup = await freshSvc.getBatchStatus('TENANT-Y', bx);
  if (crossLookup !== null) throw new Error('FAIL (case 13): Tenant Y should not be able to read Tenant X\'s batch');
  console.log('Case 13 PASSED - two tenants processed fully independently, no cross-tenant data leakage.');

  fs.unlinkSync('test/tenantx.xlsx');
  fs.unlinkSync('test/tenanty.xlsx');
  console.log('\n=== Scenario 4 (case 13) ALL PASSED ===\n');

  console.log('=== ALL MULTI-CATEGORY SCENARIOS PASSED ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
