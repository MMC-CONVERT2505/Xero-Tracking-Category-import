// Test 1 + Test 3: category ALREADY EXISTS in Xero -> reused as-is (never
// re-created), and merges correctly across multiple sheets of the same
// detected category into one import job.
const Module = require('module');
const origLoad = Module._load;

let fakeCategories = [{ TrackingCategoryID: 'CAT-1', Name: 'Class', Status: 'ACTIVE', Options: [
  { TrackingOptionID: 'OPT-EXIST', Name: '212F00001', Status: 'ACTIVE' },
] }];
let optionSeq = 0;
let failCount = 0;

Module._load = function (request, parent, isMain) {
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async () => fakeCategories,
      getTrackingCategory: async (tenantId, id) => fakeCategories.find(c => c.TrackingCategoryID === id),
      createTrackingCategory: async () => { throw new Error('FAIL: should not create - "Class" already exists'); },
      createTrackingOption: async (tenantId, categoryId, name) => {
        if (failCount > 0) { failCount -= 1; const e = new Error('rate limited'); e.response = { status: 429, headers: {} }; throw e; }
        optionSeq += 1;
        const opt = { TrackingOptionID: `OPT-${optionSeq}`, Name: name, Status: 'ACTIVE' };
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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Class'], ['2020PART00001'], ['212F00001'], ['212F00001'], ['212F00002']]), 'Sheet1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Class'], ['33CREAT00001']]), 'Sheet2');
  XLSX.writeFile(wb, 'test/auto.xlsx');
  const buf = fs.readFileSync('test/auto.xlsx');

  const preflight = await trackingImportService.validateUpload('TENANT-1', buf, 'auto.xlsx');
  const classGroup = preflight.categories.find(c => c.categoryNameInFile === 'Class');
  console.log('preflight status:', classGroup.status, '| existing:', classGroup.existingOptionsCount, '| new:', classGroup.newOptionsCount);
  if (classGroup.status !== 'FOUND') throw new Error('FAIL: existing "Class" should resolve as FOUND, not require creation');

  failCount = 2;
  const { jobs, skipped } = await trackingImportService.startImport('TENANT-1', preflight.uploadToken);
  if (skipped.length !== 0) throw new Error('FAIL: nothing should be skipped');

  const importId = jobs[0].importId;
  let status;
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    status = await trackingImportService.getStatus(importId);
    if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(status.status)) break;
  }
  console.log('final status:', status.status, '| created:', status.successfulOptions);
  if (status.status !== 'SUCCESS' || status.successfulOptions !== 3) throw new Error('FAIL: expected 3 options created successfully');

  const classCategories = fakeCategories.filter(c => c.Name === 'Class');
  if (classCategories.length !== 1) throw new Error('FAIL: a duplicate category was created');

  fs.unlinkSync('test/auto.xlsx');
  console.log('ALL ASSERTIONS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
