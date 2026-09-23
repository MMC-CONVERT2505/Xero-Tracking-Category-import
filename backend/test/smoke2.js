// Test 2: category does NOT exist -> auto-created -> options imported under it.
// Test 4: uploading the SAME file a second time must not create a duplicate
// category or duplicate options.
// Also: ARCHIVED categories are still always blocked (never auto-created
// over, never reused) - that rule didn't change.
const Module = require('module');
const origLoad = Module._load;

let fakeCategories = [
  { TrackingCategoryID: 'CAT-OLD', Name: 'Department', Status: 'ARCHIVED', Options: [] },
];
let categorySeq = 0;
let optionSeq = 0;

Module._load = function (request, parent, isMain) {
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (tenantId, id) => fakeCategories.find(c => c.TrackingCategoryID === id),
      createTrackingCategory: async (tenantId, name) => {
        categorySeq += 1;
        const cat = { TrackingCategoryID: `CAT-NEW-${categorySeq}`, Name: name, Status: 'ACTIVE', Options: [] };
        fakeCategories.push(cat);
        return cat;
      },
      createTrackingOption: async (tenantId, categoryId, name) => {
        optionSeq += 1;
        const opt = { TrackingOptionID: `OPT-${optionSeq}`, Name: name, Status: 'ACTIVE' };
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Class'], ['2020PART00001'], ['212F00001'], ['212F00002']]), 'S1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Department'], ['Sales']]), 'S2'); // archived, must stay blocked
  XLSX.writeFile(wb, 'test/create.xlsx');
  const buf = fs.readFileSync('test/create.xlsx');

  console.log('--- Test 2: "Class" does not exist yet ---');
  const preflight1 = await trackingImportService.validateUpload('T1', buf, 'create.xlsx');
  const classGroup1 = preflight1.categories.find(c => c.categoryNameInFile === 'Class');
  const deptGroup1 = preflight1.categories.find(c => c.categoryNameInFile === 'Department');
  console.log('Class:', classGroup1.status, '| Department:', deptGroup1.status);
  if (classGroup1.status !== 'NOT_FOUND') throw new Error('FAIL: Class should be NOT_FOUND before creation');
  if (deptGroup1.status !== 'ARCHIVED') throw new Error('FAIL: Department should be ARCHIVED');

  console.log('--- resolveCategory("Class") = "Continue Import" ---');
  const resolved = await trackingImportService.resolveCategory('T1', preflight1.uploadToken, classGroup1.key);
  console.log('resolved:', resolved.status, resolved.trackingCategoryId, 'wasCreated:', resolved.wasCreated, '| new options:', resolved.newOptionsCount);
  if (resolved.status !== 'FOUND' || !resolved.wasCreated) throw new Error('FAIL: Class should now be FOUND and wasCreated=true');

  console.log('--- attempt to resolveCategory("Department") - archived, must be rejected ---');
  try {
    await trackingImportService.resolveCategory('T1', preflight1.uploadToken, deptGroup1.key);
    throw new Error('FAIL: resolving an archived category should have thrown');
  } catch (err) {
    if (err.code !== 'CATEGORY_ARCHIVED') throw err;
    console.log('correctly rejected:', err.code);
  }

  const { jobs, skipped } = await trackingImportService.startImport('T1', preflight1.uploadToken);
  console.log('jobs:', jobs.map(j => `${j.categoryName} (${j.trackingCategoryId})`), '| skipped:', skipped.map(s => s.categoryNameInFile));
  if (jobs.length !== 1 || skipped.length !== 1) throw new Error('FAIL: expected 1 job (Class) + 1 skipped (Department)');
  await waitTerminal(trackingImportService, jobs[0].importId);

  console.log('--- Test 4: upload the SAME file again - must reuse "Class", no duplicates ---');
  const preflight2 = await trackingImportService.validateUpload('T1', buf, 'create.xlsx');
  const classGroup2 = preflight2.categories.find(c => c.categoryNameInFile === 'Class');
  console.log('second upload, Class status:', classGroup2.status, '| existing:', classGroup2.existingOptionsCount, '| new:', classGroup2.newOptionsCount);
  if (classGroup2.status !== 'FOUND') throw new Error('FAIL: second upload should find "Class" immediately (already exists)');
  if (classGroup2.trackingCategoryId !== resolved.trackingCategoryId) throw new Error('FAIL: second upload resolved to a DIFFERENT category id - duplicate created!');
  if (classGroup2.newOptionsCount !== 0) throw new Error(`FAIL: all 3 options already exist, expected 0 new, got ${classGroup2.newOptionsCount}`);

  const { jobs: jobs2 } = await trackingImportService.startImport('T1', preflight2.uploadToken);
  const status2 = await waitTerminal(trackingImportService, jobs2[0].importId);
  console.log('second import result:', status2.status, '| created:', status2.successfulOptions, '(should be 0 - all already existed)');
  if (status2.successfulOptions !== 0) throw new Error('FAIL: re-uploading should not create duplicate options');

  const classCategories = fakeCategories.filter(c => c.Name === 'Class');
  if (classCategories.length !== 1) throw new Error(`FAIL: expected exactly 1 "Class" category, found ${classCategories.length}`);

  fs.unlinkSync('test/create.xlsx');
  console.log('ALL ASSERTIONS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
