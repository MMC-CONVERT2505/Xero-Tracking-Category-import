/**
 * Parses uploaded XLSX/XLS/CSV files with AUTO-DETECTED Tracking
 * Categories: EVERY column's header is a Tracking Category name, and
 * every non-empty cell below it in that column is one of its options. No
 * "CategoryName" / "OptionName" two-column format, and no separate
 * category selection step - the user is never asked to name or pick a
 * category.
 *
 * Single category (still the common case, unchanged from before):
 *   Class
 *   2020PART00001
 *   212F00001
 * -> one category "Class", options ["2020PART00001", "212F00001"]
 *
 * Multiple categories, same sheet (new):
 *   Class,Department
 *   CLIFTONS00001,Sales
 *   CLIFTONS00002,HR
 *   CLIFTONS00003,Finance
 *   CLIFTONS00004,
 * -> category "Class" (4 options) AND category "Department" (3 options,
 *    independently - columns are read independently, so one column
 *    running longer than another, or having gaps, is fine: an empty cell
 *    in one column's row doesn't affect any other column).
 *
 * A column with an empty/blank header is simply not a category and is
 * skipped - never guessed at. Two columns that happen to share the same
 * header (in one sheet, or across different sheets) merge into the same
 * category, exactly like two sheets with the same single-column header
 * already did - nothing here decides which Xero category anything maps
 * to, that's trackingImportService.js.
 *
 * Uses SheetJS (xlsx), which also parses CSV (as a single-sheet workbook)
 * through the same code path - no separate CSV handling needed. Reads the
 * whole workbook into memory: fine for the 10-20k row range (a few MB); if
 * you need to support truly huge files (100k+ rows / hundreds of MB), swap
 * the xlsx read call for exceljs's streaming reader - only this module
 * would change.
 */
const XLSX = require('xlsx');
const { normalizeForCompare, cleanDisplayValue } = require('../utils/normalize');

/**
 * @param {Buffer} fileBuffer
 * @returns {{
 *   groups: Array<{ key: string, categoryNameInFile: string, records: Array<{optionName:string, sheetName:string, rowNumber:number, columnIndex:number}> }>,
 *   errors: Array<{ sheet: string, row: number, error: string }>,
 *   sheetsProcessed: string[]
 * }}
 */
function parseAutoDetectCategories(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const errors = [];
  const sheetsProcessed = [];
  const groupsByKey = new Map(); // normalized category name -> { categoryNameInFile, records: [] }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false });
    if (rows.length === 0) continue;

    const headerRow = rows[0] || [];
    // One category column per non-empty header cell. A duplicate header
    // within the same row (two columns both called "Class") is handled
    // for free: both columns' cells land in the same group, keyed by
    // normalized name, exactly like two sheets sharing a header already did.
    const columns = []; // [{ columnIndex, categoryNameInFile }]
    for (let c = 0; c < headerRow.length; c += 1) {
      const categoryNameInFile = cleanDisplayValue(headerRow[c]);
      if (categoryNameInFile) columns.push({ columnIndex: c, categoryNameInFile });
    }

    if (columns.length === 0) {
      errors.push({
        sheet: sheetName,
        row: 1,
        error: 'No column headers found - each column\'s header should be a Tracking Category name (e.g. "Class").',
      });
      continue;
    }

    sheetsProcessed.push(sheetName);

    for (const { columnIndex, categoryNameInFile } of columns) {
      const key = normalizeForCompare(categoryNameInFile);
      if (!groupsByKey.has(key)) groupsByKey.set(key, { categoryNameInFile, records: [] });
      const group = groupsByKey.get(key);

      // Each column is scanned independently down the full row range of
      // the sheet - a shorter or gappier column (fewer options than its
      // neighbour, or a blank cell partway down) never affects any other
      // column's own options.
      for (let i = 1; i < rows.length; i += 1) {
        const rowNumber = i + 1;
        const raw = rows[i]?.[columnIndex];
        const optionName = cleanDisplayValue(raw);
        if (!optionName) continue; // blank cell in this column at this row - skip silently
        group.records.push({ optionName, sheetName, rowNumber, columnIndex });
      }
    }
  }

  return {
    groups: [...groupsByKey.entries()].map(([key, g]) => ({ key, ...g })),
    errors,
    sheetsProcessed,
  };
}

module.exports = { parseAutoDetectCategories };
