/**
 * CSV ingestion: wraps PapaParse (loaded globally via CDN as `Papa`) and
 * converts raw rows into cleaned {@link TransactionRecord} objects.
 */

/**
 * @typedef {Object} TransactionRecord
 * @property {Date} date - Parsed, validated Date object (local time).
 * @property {string} dateRaw - Original date string, quote-stripped & trimmed.
 * @property {string} posId - Trimmed POS_ID.
 * @property {number} amount - Cleaned numeric amount (commas stripped).
 * @property {string} amountRaw - Original amount string, cleaned but unparsed.
 * @property {Object<string,string>} row - Full original row (all columns).
 */

const REQUIRED_COLUMNS = ['Transaction_Date', 'POS_ID', 'Amount'];

/**
 * Strips a leading/trailing Excel text-escape apostrophe and surrounding
 * whitespace from a raw CSV field.
 * @param {string} value
 * @returns {string}
 */
function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/^'+|'+$/g, '').trim();
}

/**
 * Cleans and parses a raw date string into a Date, or null if invalid.
 * Handles the common "YYYY-MM-DD HH:mm:ss" shape as well as anything the
 * native Date constructor can parse.
 * @param {string} raw
 * @returns {Date|null}
 */
function parseTransactionDate(raw) {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;
  const isoLike = cleaned.includes(' ') && !cleaned.includes('T')
    ? cleaned.replace(' ', 'T')
    : cleaned;
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Cleans and parses a raw amount string (strips thousands commas/currency
 * symbols) into a finite number, or null if invalid.
 * @param {string} raw
 * @returns {number|null}
 */
function cleanAmountToNumber(raw) {
  const cleaned = cleanText(raw).replace(/[₹,\s]/g, '');
  if (cleaned === '') return null;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses a CSV File into cleaned transaction records using PapaParse.
 * Malformed rows (missing/invalid date, amount, or POS_ID) are skipped and
 * counted rather than throwing, so one bad row doesn't sink the whole file.
 * @param {File} file
 * @param {(progress: {percent: number}) => void} [onProgress]
 * @returns {Promise<{records: TransactionRecord[], headers: string[], rowCount: number, skippedCount: number}>}
 */
function parseCsvFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const records = [];
    let headers = [];
    let rowCount = 0;
    let skippedCount = 0;
    let headersValidated = false;
    /** Maps a required column name to the raw (untrimmed) header key PapaParse used. */
    let columnKeyMap = {};

    // Note: `worker: true` sends the parse config to a Web Worker via
    // postMessage, which cannot carry function values (transformHeader,
    // transform, step) — the structured clone algorithm throws. So header
    // whitespace is trimmed here, after parsing, by resolving each required
    // column name to its raw header key once and reusing that mapping.
    // eslint-disable-next-line no-undef
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      chunk: (results, parser) => {
        if (!headersValidated) {
          const rawHeaders = results.meta.fields || [];
          headers = rawHeaders.map((h) => h.trim());

          for (const required of REQUIRED_COLUMNS) {
            const rawKey = rawHeaders.find((h) => h.trim() === required);
            if (rawKey !== undefined) columnKeyMap[required] = rawKey;
          }

          const missing = REQUIRED_COLUMNS.filter((c) => !(c in columnKeyMap));
          if (missing.length > 0) {
            parser.abort();
            reject(new Error(`CSV is missing required column(s): ${missing.join(', ')}`));
            return;
          }
          headersValidated = true;
        }

        for (const row of results.data) {
          rowCount += 1;
          const date = parseTransactionDate(row[columnKeyMap.Transaction_Date]);
          const amount = cleanAmountToNumber(row[columnKeyMap.Amount]);
          const posId = cleanText(row[columnKeyMap.POS_ID]);

          if (!date || amount === null || !posId) {
            skippedCount += 1;
            continue;
          }

          records.push({
            date,
            dateRaw: cleanText(row[columnKeyMap.Transaction_Date]),
            posId,
            amount,
            amountRaw: cleanText(row[columnKeyMap.Amount]),
            row,
          });
        }

        if (onProgress && results.meta.cursor && file.size) {
          onProgress({ percent: Math.min(100, Math.round((results.meta.cursor / file.size) * 100)) });
        }
      },
      complete: () => {
        if (onProgress) onProgress({ percent: 100 });
        resolve({ records, headers, rowCount, skippedCount });
      },
      error: (err) => reject(err),
    });
  });
}
