/**
 * Business-day preset computation and fast filtered aggregation. Every
 * function here is pure (no DOM access) so it can be unit-reasoned-about
 * and reused by both the live preview and the XLSX export.
 */

/**
 * Computes the [start, end) business-day window for a POS, anchored to its
 * earliest transaction. If the earliest transaction falls before the
 * preset's rollover hour on its own calendar date, the window is shifted
 * back one day so that transaction is included.
 * @param {import('./parser.js').TransactionRecord[]} posRecords - Sorted ascending by date; must be non-empty.
 * @param {number} presetHour - 6 or 8 (the rollover hour).
 * @returns {{start: Date, end: Date}}
 */
function computeBusinessDayWindow(posRecords, presetHour) {
  const earliest = posRecords[0].date;
  const anchorMidnight = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());

  const candidateStart = new Date(anchorMidnight);
  candidateStart.setHours(presetHour, 0, 0, 0);

  let start = candidateStart;
  if (earliest < candidateStart) {
    start = new Date(candidateStart);
    start.setDate(start.getDate() - 1);
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

/**
 * Validates a filter range, returning a reason string when invalid.
 * @param {Date|null} start
 * @param {Date|null} end
 * @returns {{valid: boolean, reason?: string}}
 */
function validateFilterRange(start, end) {
  if (!start || Number.isNaN(start.getTime())) {
    return { valid: false, reason: 'Start date/time is missing or invalid.' };
  }
  if (!end || Number.isNaN(end.getTime())) {
    return { valid: false, reason: 'End date/time is missing or invalid.' };
  }
  if (end <= start) {
    return { valid: false, reason: 'End must be after Start.' };
  }
  return { valid: true };
}

/**
 * Computes the filtered transaction count and total for one POS using
 * binary search over its pre-sorted records + prefix sums — O(log n)
 * regardless of dataset size.
 * @param {import('./parser.js').TransactionRecord[]} posRecords - Sorted ascending by date.
 * @param {number[]} prefixSums - Parallel prefix-sum array for posRecords.
 * @param {Date} start - Inclusive lower bound.
 * @param {Date} end - Exclusive upper bound.
 * @returns {{count: number, total: number, lo: number, hi: number}}
 */
function recomputePos(posRecords, prefixSums, start, end) {
  const lo = lowerBound(posRecords, start.getTime(), (r) => r.date.getTime());
  const hi = lowerBound(posRecords, end.getTime(), (r) => r.date.getTime());
  const count = Math.max(0, hi - lo);
  const total = count === 0 ? 0 : prefixSums[hi - 1] - (lo > 0 ? prefixSums[lo - 1] : 0);
  return { count, total, lo, hi };
}

/**
 * Computes the grand summary across all currently-valid, filtered POS
 * results: grand total and grand transaction count.
 * @param {Map<string, {count: number, total: number, valid: boolean}>} resultsByPos
 * @returns {{grandTotal: number, grandCount: number}}
 */
function computeGrandSummary(resultsByPos) {
  let grandTotal = 0;
  let grandCount = 0;

  for (const result of resultsByPos.values()) {
    if (!result.valid) continue;
    grandTotal += result.total;
    grandCount += result.count;
  }

  return { grandTotal, grandCount };
}

/**
 * Serializes filtered records for one POS into filtered-CSV row lines
 * (excluding the header, which the caller prepends once).
 * @param {import('./parser.js').TransactionRecord[]} posRecords - Sorted ascending by date.
 * @param {number} lo - Inclusive start index (from {@link recomputePos}).
 * @param {number} hi - Exclusive end index (from {@link recomputePos}).
 * @returns {string[]}
 */
function filteredRecordsToCsvRows(posRecords, lo, hi) {
  const rows = [];
  for (let i = lo; i < hi; i += 1) {
    const r = posRecords[i];
    rows.push(toCsvRow([r.dateRaw, r.posId, r.amount]));
  }
  return rows;
}

/**
 * Computes average/highest/lowest transaction amount over a filtered
 * range. A single linear scan; cheap even at 100k+ scale since it only
 * runs on debounced filter changes, not on every animation frame.
 * @param {import('./parser.js').TransactionRecord[]} posRecords - Sorted ascending by date.
 * @param {number} lo - Inclusive start index.
 * @param {number} hi - Exclusive end index.
 * @returns {{avg: number, high: number, low: number}|null} null if the range is empty
 */
function computePosRangeStats(posRecords, lo, hi) {
  if (hi <= lo) return null;
  let sum = 0;
  let high = -Infinity;
  let low = Infinity;
  for (let i = lo; i < hi; i += 1) {
    const amount = posRecords[i].amount;
    sum += amount;
    if (amount > high) high = amount;
    if (amount < low) low = amount;
  }
  return { avg: sum / (hi - lo), high, low };
}
