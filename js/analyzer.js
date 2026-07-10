/**
 * Groups parsed transaction records by POS_ID and computes per-POS
 * statistics. Builds the sorted arrays + prefix sums that filters.js
 * relies on for O(log n) range queries.
 */

/**
 * Groups records by POS_ID, sorts each group ascending by date, and builds
 * a parallel prefix-sum array of amounts for each group.
 * @param {import('./parser.js').TransactionRecord[]} records
 * @returns {{
 *   posMap: Map<string, import('./parser.js').TransactionRecord[]>,
 *   prefixSums: Map<string, number[]>,
 *   posIds: string[],
 * }}
 */
function buildPosMap(records) {
  const posMap = new Map();

  for (const record of records) {
    if (!posMap.has(record.posId)) posMap.set(record.posId, []);
    posMap.get(record.posId).push(record);
  }

  const prefixSums = new Map();
  for (const [posId, arr] of posMap) {
    arr.sort((a, b) => a.date.getTime() - b.date.getTime());

    const sums = new Array(arr.length);
    let running = 0;
    for (let i = 0; i < arr.length; i += 1) {
      running += arr[i].amount;
      sums[i] = running;
    }
    prefixSums.set(posId, sums);
  }

  const posIds = Array.from(posMap.keys()).sort((a, b) => a.localeCompare(b));

  return { posMap, prefixSums, posIds };
}

/**
 * Computes read-only summary statistics for a single POS: earliest/latest
 * transaction, transaction count, and total amount (over the *entire*
 * dataset for that POS, unaffected by any filter).
 * @param {import('./parser.js').TransactionRecord[]} posRecords - Sorted ascending by date.
 * @returns {{earliest: Date|null, latest: Date|null, count: number, total: number}}
 */
function computePosStats(posRecords) {
  if (!posRecords || posRecords.length === 0) {
    return { earliest: null, latest: null, count: 0, total: 0 };
  }
  let total = 0;
  for (const record of posRecords) total += record.amount;

  return {
    earliest: posRecords[0].date,
    latest: posRecords[posRecords.length - 1].date,
    count: posRecords.length,
    total,
  };
}
