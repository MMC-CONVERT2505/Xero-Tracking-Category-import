// Category typo/mismatch confirmation regression suite - covers spec test
// cases 1-13. Each case uses its own tenant so Xero's real 2-active-
// category limit never accidentally cross-contaminates an unrelated case.
process.env.XERO_MAX_REQUESTS_PER_MINUTE = '100000';

const Module = require('module');
const origLoad = Module._load;

const categoriesByTenant = new Map();
categoriesByTenant.set('T1', [
  { TrackingCategoryID: 'CAT-CLASS', Name: 'Class', Status: 'ACTIVE', Options: [] },
  { TrackingCategoryID: 'CAT-DEPT', Name: 'Department', Status: 'ACTIVE', Options: [] },
]);
let createCategoryCalls = [];

Module._load = function (request, parent, isMain) {
  if (request === './xeroClient' || request === '../services/xeroClient') {
    return {
      listTrackingCategories: async (tenantId) => categoriesByTenant.get(tenantId) || [],
      getTrackingCategory: async (tenantId, id) => (categoriesByTenant.get(tenantId) || []).find((c) => c.TrackingCategoryID === id),
      createTrackingCategory: async (tenantId, name) => {
        createCategoryCalls.push(`${tenantId}:${name}`);
        const list = categoriesByTenant.get(tenantId) || [];
        const cat = { TrackingCategoryID: `CAT-NEW-${createCategoryCalls.length}`, Name: name, Status: 'ACTIVE', Options: [] };
        list.push(cat);
        categoriesByTenant.set(tenantId, list);
        return cat;
      },
      createTrackingOption: async (tenantId, categoryId, name) => {
        const cat = (categoriesByTenant.get(tenantId) || []).find((c) => c.TrackingCategoryID === categoryId);
        const opt = { TrackingOptionID: `OPT-${name}`, Name: name, Status: 'ACTIVE' };
        cat.Options.push(opt);
        return { Options: [opt] };
      },
    };
  }
  return origLoad.apply(this, arguments);
};

function xlsxBuffer(XLSX, headers, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'S1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function main() {
  let svc = require('../src/services/trackingImportService');
  const XLSX = require('xlsx');

  // ===== Cases 1, 2, 3, 4, 5, 6: classification correctness (tenant T1) =====
  console.log('=== Cases 1-6: classification ===');
  let buf = xlsxBuffer(XLSX, ['Class', 'Department', 'Clas', 'class', 'Departmant', 'Widget'], [['A', 'X', 'B', 'C', 'Y', 'Z']]);
  let pf = await svc.validateUpload('T1', buf, 't.xlsx');
  const byName = Object.fromEntries(pf.categories.map((c) => [c.categoryNameInFile, c]));

  if (byName.Class.status !== 'FOUND') throw new Error('FAIL (case 1): "Class" should be an exact match, no popup');
  if (byName.Department.status !== 'FOUND') throw new Error('FAIL (case 4): "Department" should be an exact match, no popup');
  // Case 3: lowercase "class" normalizes to the SAME key as "Class" and
  // merges into that one group (same mechanism that already merges
  // duplicate headers/sheets sharing a name) - so it's not a separate
  // popup-eligible entry at all, it's already inside the "Class" FOUND
  // group. Confirm both columns' options landed there.
  if (byName.Class.uniqueOptionsCount !== 2) throw new Error(`FAIL (case 3): "class" should have merged into "Class" (2 unique options: A, C), got ${byName.Class.uniqueOptionsCount}`);
  if (byName.Clas.status !== 'POSSIBLE_MISMATCH' || byName.Clas.suggestion?.name !== 'Class') throw new Error(`FAIL (case 2): "Clas" should show a popup suggesting "Class", got ${JSON.stringify(byName.Clas)}`);
  if (byName.Departmant.status !== 'POSSIBLE_MISMATCH' || byName.Departmant.suggestion?.name !== 'Department') throw new Error(`FAIL (case 5): "Departmant" should show a popup suggesting "Department", got ${JSON.stringify(byName.Departmant)}`);
  if (byName.Widget.status !== 'NOT_FOUND' || byName.Widget.suggestion) throw new Error(`FAIL (case 6): "Widget" is unrelated - should be plain NOT_FOUND with no suggestion, got ${JSON.stringify(byName.Widget)}`);
  console.log('Cases 1-6 PASSED\n');

  // ===== Case 7: "Use existing" =====
  console.log('=== Case 7: user selects "Use existing" ===');
  const clasResolved = await svc.resolveCategory('T1', pf.uploadToken, byName.Clas.key, 'use_existing');
  if (clasResolved.trackingCategoryId !== 'CAT-CLASS') throw new Error(`FAIL (case 7): expected reuse of CAT-CLASS, got ${clasResolved.trackingCategoryId}`);
  if (clasResolved.wasCreated) throw new Error('FAIL (case 7): "Use existing" must never create anything');
  if (createCategoryCalls.some((c) => c.endsWith(':Clas'))) throw new Error('FAIL (case 7): "Clas" was created despite choosing "Use existing"');
  console.log('Case 7 PASSED - reused existing "Class", "Clas" was never created.\n');

  // ===== Case 8: "Create new" (separate tenant, room under the limit) =====
  console.log('=== Case 8: user selects "Create new" ===');
  categoriesByTenant.set('T3', [{ TrackingCategoryID: 'CAT-T3-DEPT', Name: 'Department', Status: 'ACTIVE', Options: [] }]);
  const pf8 = await svc.validateUpload('T3', xlsxBuffer(XLSX, ['Departmant'], [['Sales']]), 't8.xlsx');
  const deptmantGroup = pf8.categories[0];
  if (deptmantGroup.status !== 'POSSIBLE_MISMATCH' || deptmantGroup.suggestion?.name !== 'Department') {
    throw new Error(`FAIL (case 8 setup): expected a mismatch prompt suggesting "Department", got ${JSON.stringify(deptmantGroup)}`);
  }
  const deptmantResolved = await svc.resolveCategory('T3', pf8.uploadToken, deptmantGroup.key, 'create_new');
  if (!deptmantResolved.wasCreated) throw new Error('FAIL (case 8): "Create new" should have created a category');
  if (deptmantResolved.categoryName !== 'Departmant') throw new Error(`FAIL (case 8): should create the name EXACTLY as uploaded ("Departmant"), not silently corrected - got "${deptmantResolved.categoryName}"`);
  if (!createCategoryCalls.includes('T3:Departmant')) throw new Error('FAIL (case 8): createTrackingCategory was not called with "Departmant"');
  console.log('Case 8 PASSED - "Departmant" created exactly as typed, never silently corrected to "Department".\n');

  // ===== Case 9: user cancels (never calls resolveCategory for "Widget") =====
  console.log('=== Case 9: user cancels the popup / leaves "Widget" unresolved ===');
  const { jobs, skipped } = await svc.startImport('T1', pf.uploadToken);
  const widgetSkipped = skipped.find((s) => s.categoryNameInFile === 'Widget');
  if (!widgetSkipped) throw new Error('FAIL (case 9): "Widget" (never resolved) should be skipped, not imported');
  if (jobs.some((j) => j.categoryName === 'Widget')) throw new Error('FAIL (case 9): a job must not exist for an unresolved category');
  if (createCategoryCalls.some((c) => c.endsWith(':Widget'))) throw new Error('FAIL (case 9): "Widget" must not have been created without a decision');
  console.log('Case 9 PASSED - unresolved category was skipped entirely, nothing created, no options pushed.\n');

  // ===== Case 10: restart while confirmation is pending =====
  console.log('=== Case 10: restart while a mismatch confirmation is still pending ===');
  categoriesByTenant.set('T2', [{ TrackingCategoryID: 'CAT-T2-CLASS', Name: 'Class', Status: 'ACTIVE', Options: [] }]);
  const pf2 = await svc.validateUpload('T2', xlsxBuffer(XLSX, ['Clas'], [['X'], ['Y']]), 't2.xlsx');
  const clasKey2 = pf2.categories[0].key;
  if (pf2.categories[0].status !== 'POSSIBLE_MISMATCH') throw new Error('FAIL (case 10 setup): expected a pending mismatch');
  // Simulate a restart: pendingUploads is deliberately in-memory only (see
  // trackingImportService.js header comment) - nothing has been written to
  // Xero yet, so clearing it is the correct, safest "resume" behaviour: no
  // category can possibly be auto-created from a restart, because there is
  // nothing left to resume FROM. The user simply re-uploads.
  delete require.cache[require.resolve('../src/services/trackingImportService')];
  delete require.cache[require.resolve('../src/db/store')];
  svc = require('../src/services/trackingImportService');
  try {
    await svc.resolveCategory('T2', pf2.uploadToken, clasKey2, 'create_new');
    throw new Error('FAIL (case 10): a stale uploadToken should not resolve after "restart"');
  } catch (err) {
    if (err.code !== 'UPLOAD_TOKEN_NOT_FOUND') throw err;
  }
  if (createCategoryCalls.some((c) => c.startsWith('T2:'))) throw new Error('FAIL (case 10): nothing should have auto-created after "restart"');
  console.log('Case 10 PASSED - a pending confirmation does not survive a restart, and nothing gets auto-created because of that.\n');

  // ===== Case 11: two similar existing categories - pick the closer one =====
  console.log('=== Case 11: two similar existing categories ===');
  categoriesByTenant.set('T4', [
    { TrackingCategoryID: 'CAT-T4-CLASS', Name: 'Class', Status: 'ACTIVE', Options: [] },
    { TrackingCategoryID: 'CAT-T4-CLASSIC', Name: 'Classic', Status: 'ACTIVE', Options: [] },
  ]);
  const pf11 = await svc.validateUpload('T4', xlsxBuffer(XLSX, ['Clas'], [['A']]), 't11.xlsx');
  const g11 = pf11.categories[0];
  if (g11.status !== 'POSSIBLE_MISMATCH') throw new Error(`FAIL (case 11): expected a mismatch prompt, got ${JSON.stringify(g11)}`);
  if (g11.suggestion.name !== 'Class') throw new Error(`FAIL (case 11): "Clas" is closer to "Class" (distance 1) than "Classic" (distance 3) - expected "Class", got "${g11.suggestion.name}"`);
  console.log(`Case 11 PASSED - correctly picked the closer of two similar existing categories ("${g11.suggestion.name}").\n`);

  // ===== Case 12: multi-category file, one typo + one valid =====
  console.log('=== Case 12: multi-category file with one typo category and one valid category ===');
  categoriesByTenant.set('T5', [{ TrackingCategoryID: 'CAT-T5-CLASS', Name: 'Class', Status: 'ACTIVE', Options: [] }]);
  const pf12 = await svc.validateUpload('T5', xlsxBuffer(XLSX, ['Clas', 'Location'], [['A', 'India'], ['B', 'Japan']]), 't12.xlsx');
  const byName12 = Object.fromEntries(pf12.categories.map((c) => [c.categoryNameInFile, c]));
  if (byName12.Clas.status !== 'POSSIBLE_MISMATCH') throw new Error('FAIL (case 12): "Clas" should prompt a mismatch');
  if (byName12.Location.status !== 'NOT_FOUND') throw new Error('FAIL (case 12): "Location" is unrelated to "Class" - should proceed via normal auto-create, not a popup');
  await svc.resolveCategory('T5', pf12.uploadToken, byName12.Location.key); // normal auto-create, no decision needed
  await svc.resolveCategory('T5', pf12.uploadToken, byName12.Clas.key, 'use_existing');
  const { jobs: jobs12 } = await svc.startImport('T5', pf12.uploadToken);
  if (jobs12.length !== 2) throw new Error(`FAIL (case 12): expected both categories to import independently, got ${jobs12.length} job(s)`);
  const clasJob12 = jobs12.find((j) => j.categoryName === 'Class');
  if (!clasJob12 || clasJob12.trackingCategoryId !== 'CAT-T5-CLASS') throw new Error('FAIL (case 12): the typo column should have imported into the EXISTING "Class", once resolved');
  console.log('Case 12 PASSED - typo category required confirmation, valid category proceeded normally, both imported independently.\n');

  // ===== Case 13: Xero\'s 2-active-category limit is respected =====
  console.log('=== Case 13: 2-category Xero limit respected ===');
  categoriesByTenant.set('T6', [
    { TrackingCategoryID: 'CAT-T6-CLASS', Name: 'Class', Status: 'ACTIVE', Options: [] },
    { TrackingCategoryID: 'CAT-T6-DEPT', Name: 'Department', Status: 'ACTIVE', Options: [] },
  ]);
  const pf13 = await svc.validateUpload('T6', xlsxBuffer(XLSX, ['Departmant', 'Widget'], [['A', 'B']]), 't13.xlsx');
  const byName13 = Object.fromEntries(pf13.categories.map((c) => [c.categoryNameInFile, c]));
  if (!byName13.Departmant.categoryLimitReached) throw new Error('FAIL (case 13): should flag the limit as already reached (2 active categories exist)');
  if (!byName13.Widget.categoryLimitReached) throw new Error('FAIL (case 13): "Widget" (NOT_FOUND, no suggestion) should also be flagged as blocked by the limit');
  // "Use existing" must still work even at the limit (it's a reuse, not a creation).
  const deptmantAtLimit = await svc.resolveCategory('T6', pf13.uploadToken, byName13.Departmant.key, 'use_existing');
  if (deptmantAtLimit.trackingCategoryId !== 'CAT-T6-DEPT') throw new Error('FAIL (case 13): "Use existing" should still work at the limit');
  // "Create new" must be blocked at the limit, with a clear reason.
  try {
    await svc.resolveCategory('T6', pf13.uploadToken, byName13.Departmant.key, 'create_new');
    // (idempotent no-op is fine here since Departmant already resolved to FOUND above - re-test with a fresh group)
  } catch (e) { /* acceptable either way since it's already FOUND */ }
  const pf13b = await svc.validateUpload('T6', xlsxBuffer(XLSX, ['Widget'], [['C']]), 't13b.xlsx');
  try {
    await svc.resolveCategory('T6', pf13b.uploadToken, pf13b.categories[0].key, 'create_new');
    throw new Error('FAIL (case 13): creating a brand-new category at the limit should have been rejected');
  } catch (err) {
    if (err.code !== 'ACTIVE_CATEGORY_LIMIT_REACHED') throw err;
  }
  if (createCategoryCalls.some((c) => c.startsWith('T6:'))) throw new Error('FAIL (case 13): nothing should have been created on T6 - it was always at the limit');
  console.log('Case 13 PASSED - the real Xero 2-active-category limit blocks "Create new" with a clear reason, even though "Use existing" still works.\n');

  console.log('=== ALL 13 CASES PASSED ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
