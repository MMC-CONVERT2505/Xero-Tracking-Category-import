/**
 * Parses uploaded XLSX/XLS/CSV files with AUTO-DETECTED Tracking
 * Categories: the first column's header is the category name, and every
 * non-empty cell below it in that column is an option. No "CategoryName" /
 * "OptionName" two-column format, and no separate category selection step -
 * the user is never asked to name or pick a category.
 *
 * Example sheet:
 *   Class
 *   2020PART00001
 *   212F00001
 *
 * -> category "Class", options ["2020PART00001", "212F00001"]
 *
 * Multiple sheets can target the SAME category (merged) or DIFFERENT
 * categories (kept separate) - both are handled by grouping records by
 * normalized category name after parsing every sheet; nothing here decides
 * which Xero category anything belongs to, that's trackingImportService.js.
 *
 * Uses SheetJS (xlsx) which reads the whole workbook into memory. For files
 * in the 10-20k row range (a few MB) this is perfectly fine; if you need to
 * support truly huge files (100k+ rows / hundreds of MB), swap the xlsx
 * read call for exceljs's streaming reader - only this module would change.
 */
const XLSX = require('xlsx');
const { normalizeForCompare, cleanDisplayValue } = require('../utils/normalize');

/**
 * @param {Buffer} fileBuffer
 * @returns {{
 *   groups: Array<{ key: string, categoryNameInFile: string, records: Array<{optionName:string, sheetName:string, rowNumber:number}> }>,
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

    const headerCell = rows[0]?.[0];
    const categoryNameInFile = cleanDisplayValue(headerCell);
    if (!categoryNameInFile) {
      errors.push({
        sheet: sheetName,
        row: 1,
        error: 'The first column has no header - this should be the Tracking Category name (e.g. "Class").',
      });
      continue;
    }

    sheetsProcessed.push(sheetName);
    const key = normalizeForCompare(categoryNameInFile);
    if (!groupsByKey.has(key)) groupsByKey.set(key, { categoryNameInFile, records: [] });
    const group = groupsByKey.get(key);

    for (let i = 1; i < rows.length; i += 1) {
      const rowNumber = i + 1;
      const raw = rows[i]?.[0];
      const optionName = cleanDisplayValue(raw);
      if (!optionName) continue; // blank row in the first column - skip silently
      group.records.push({ optionName, sheetName, rowNumber });
    }
  }

  return {
    groups: [...groupsByKey.entries()].map(([key, g]) => ({ key, ...g })),
    errors,
    sheetsProcessed,
  };
}

module.exports = { parseAutoDetectCategories };
