/**
 * Normalization helpers used for duplicate detection / matching against
 * existing Xero options. Comparison is case-insensitive and whitespace
 * normalized; the ORIGINAL string is always preserved separately for the
 * value actually sent to Xero.
 */

function normalizeForCompare(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Trim + collapse whitespace but preserve original casing (for display / Xero payload). */
function cleanDisplayValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeCategoryKey(tenantId, categoryName) {
  return `${tenantId}::${normalizeForCompare(categoryName)}`;
}

/** Standard Levenshtein edit distance, used only for "did you mean" category suggestions. */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const row = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[n];
}

/**
 * Finds the single closest ACTIVE category name to `detectedName`, for the
 * "Tracking Category 'Clas' was not found - did you mean 'Class'?" prompt.
 * Never returns an exact match (that's a FOUND, not a suggestion) and never
 * suggests something wildly different - the distance threshold scales with
 * name length so short names still need to be genuinely close.
 */
function findClosestActiveCategory(detectedName, categories) {
  const target = normalizeForCompare(detectedName);
  let best = null;
  let bestDistance = Infinity;
  for (const category of categories) {
    if (category.Status !== 'ACTIVE') continue;
    const candidate = normalizeForCompare(category.Name);
    if (candidate === target) continue; // exact matches are resolved elsewhere, not "suggested"
    const distance = levenshteinDistance(target, candidate);
    if (distance < bestDistance) { bestDistance = distance; best = category; }
  }
  const threshold = Math.max(2, Math.ceil(target.length * 0.25));
  return best && bestDistance <= threshold ? best : null;
}

module.exports = {
  normalizeForCompare,
  cleanDisplayValue,
  normalizeCategoryKey,
  levenshteinDistance,
  findClosestActiveCategory,
};
