/**
 * Builds the professionally formatted XLSX workbook (via the globally
 * loaded ExcelJS) from the app's current filtered state: a "Transactions"
 * sheet with POS ids displayed two at a time, side by side (pump 1/pump 2
 * paired first when both are present, then every other POS batched in
 * twos), and a "Summary" sheet.
 */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};
const BAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const SECTION_TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE3F0' } };
const CURRENCY_FMT = '₹#,##0.00';
const DATETIME_FMT = 'yyyy-mm-dd   hh:mm:ss AM/PM';

/**
 * Re-anchors a Date's local wall-clock components onto UTC before handing
 * it to ExcelJS. ExcelJS serializes `Date` cell values using UTC-based
 * epoch math, while `record.date` (built by parser.js) carries the
 * original CSV timestamp — e.g. "2026-07-01 06:12:00", India Standard
 * Time with no offset in the source — as *local* wall-clock components.
 * Without this step, the exported cell reflects whatever offset the
 * generating browser's system timezone happens to be (shifting the
 * displayed time by that offset, e.g. -5:30 for a browser running in
 * IST), instead of the literal timestamp from the CSV. Re-anchoring makes
 * the export correct regardless of what timezone the browser is in.
 * @param {Date} date
 * @returns {Date}
 */
function toExcelDate(date) {
  return new Date(Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(),
  ));
}

/**
 * Applies the shared header style (fill/font/border) to `colCount` cells of
 * a row, starting at `startCol` (1-indexed).
 * @param {import('exceljs').Row} row
 * @param {number} colCount
 * @param {number} [startCol]
 */
function styleHeaderRow(row, colCount, startCol = 1) {
  for (let c = startCol; c < startCol + colCount; c += 1) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = THIN_BORDER;
  }
}

/**
 * Applies a thin border to `colCount` cells of a row, starting at
 * `startCol`, plus alternate-row banding when `bandIndex` is odd.
 * @param {import('exceljs').Row} row
 * @param {number} colCount
 * @param {number} startCol
 * @param {number} bandIndex
 */
function styleDataRow(row, colCount, startCol, bandIndex) {
  for (let c = startCol; c < startCol + colCount; c += 1) {
    const cell = row.getCell(c);
    cell.border = THIN_BORDER;
    if (bandIndex % 2 === 1) cell.fill = BAND_FILL;
  }
}

/**
 * Writes `values` into a row starting at `startCol` (1-indexed), leaving
 * every other cell in the row untouched.
 * @param {import('exceljs').Row} row
 * @param {number} startCol
 * @param {Array<string|number|Date>} values
 */
function setRowValues(row, startCol, values) {
  values.forEach((value, i) => {
    row.getCell(startCol + i).value = value;
  });
}

/**
 * Splits POS ids into side-by-side display batches of 2 for the
 * Transactions sheet: pump 1 and pump 2 (however they're formatted in this
 * file's POS_ID column — see {@link pumpNumber}) are always paired together
 * first when both are present, then every other POS id is grouped into
 * consecutive pairs in their existing (alphabetical) order. A trailing odd
 * POS id out gets its own solo batch.
 * @param {string[]} posIds
 * @returns {string[][]} array of 1- or 2-element POS id batches
 */
function buildPosBatches(posIds) {
  const remaining = [...posIds];
  const batches = [];

  const pump1 = remaining.find((id) => pumpNumber(id) === 1);
  const pump2 = remaining.find((id) => pumpNumber(id) === 2);
  if (pump1 && pump2) {
    batches.push([pump1, pump2]);
    remaining.splice(remaining.indexOf(pump1), 1);
    remaining.splice(remaining.indexOf(pump2), 1);
  }

  for (let i = 0; i < remaining.length; i += 2) {
    batches.push(remaining.slice(i, i + 2));
  }

  return batches;
}

/**
 * Auto-sizes every column in a worksheet based on the longest cell text
 * seen (capped to a reasonable max width).
 * @param {import('exceljs').Worksheet} worksheet
 * @param {number} colCount
 */
function autoSizeColumns(worksheet, colCount) {
  const maxLen = new Array(colCount + 1).fill(8);
  worksheet.eachRow((row) => {
    for (let c = 1; c <= colCount; c += 1) {
      const value = row.getCell(c).value;
      const text = value instanceof Date ? DATETIME_FMT : String(value ?? '');
      maxLen[c] = Math.max(maxLen[c], text.length);
    }
  });
  for (let c = 1; c <= colCount; c += 1) {
    worksheet.getColumn(c).width = Math.min(maxLen[c] + 2, 40);
  }
}

/** Number of columns (Date/POS/Amount) each POS occupies in a side-by-side batch. */
const POS_BLOCK_WIDTH = 3;
/** Column the second POS in a batch starts at (3 for the first POS + 1 blank spacer column). */
const POS_BLOCK_B_START_COL = POS_BLOCK_WIDTH + 2;
/** Total sheet columns: two 3-column POS blocks plus the 1-column spacer between them. */
const TRANSACTIONS_COL_COUNT = POS_BLOCK_WIDTH * 2 + 1;

/**
 * Writes one POS's Date/POS/Amount section (title, header, data rows,
 * count, total) into the Transactions sheet starting at `startCol`, using
 * whatever row numbers the caller has already reserved via `startRow`.
 *
 * The count/total rows are positioned using `batchDataRowCount` (the
 * *longer* of the two POS in this batch), not this POS's own record count
 * — otherwise, when the two POS have different transaction counts, the
 * shorter one's count/total rows would land in the middle of the taller
 * one's still-in-progress data rows instead of below both.
 * @param {import('exceljs').Worksheet} sheet
 * @param {number} startRow - Row number of the section title row.
 * @param {number} startCol - 1 or {@link POS_BLOCK_B_START_COL}.
 * @param {string} posId
 * @param {import('./parser.js').TransactionRecord[]} records
 * @param {{count: number, total: number}} result
 * @param {number} batchDataRowCount - max(recordsA.length, recordsB.length) for this batch.
 */
function writePosBlock(sheet, startRow, startCol, posId, records, result, batchDataRowCount) {
  const endCol = startCol + POS_BLOCK_WIDTH - 1;

  sheet.mergeCells(startRow, startCol, startRow, endCol);
  const titleCell = sheet.getRow(startRow).getCell(startCol);
  titleCell.value = `POS: ${posId}`;
  titleCell.font = { bold: true };
  titleCell.fill = SECTION_TITLE_FILL;

  const headerRow = sheet.getRow(startRow + 1);
  setRowValues(headerRow, startCol, ['Date', 'POS', 'Amount']);
  styleHeaderRow(headerRow, POS_BLOCK_WIDTH, startCol);

  records.forEach((record, idx) => {
    const row = sheet.getRow(startRow + 2 + idx);
    setRowValues(row, startCol, [toExcelDate(record.date), record.posId, round2(record.amount)]);
    row.getCell(startCol).numFmt = DATETIME_FMT;
    row.getCell(endCol).numFmt = CURRENCY_FMT;
    styleDataRow(row, POS_BLOCK_WIDTH, startCol, idx);
  });

  const countRow = sheet.getRow(startRow + 2 + batchDataRowCount);
  setRowValues(countRow, startCol, ['', 'Transaction Count', result.count]);
  countRow.font = { bold: true };

  const totalRow = sheet.getRow(startRow + 3 + batchDataRowCount);
  setRowValues(totalRow, startCol, ['', 'Total Amount', round2(result.total)]);
  totalRow.font = { bold: true };
  totalRow.getCell(endCol).numFmt = CURRENCY_FMT;
}

/**
 * Builds the "Transactions" sheet: `PUMP-01`/`PUMP-02` displayed side by
 * side first (when both are present), then every other POS batched two at
 * a time, also side by side, each batch stacked below the last with a
 * blank separator row. No autoFilter is applied here — ExcelJS/Excel
 * support only one filter range per sheet, and this sheet's multiple
 * repeating header rows are structurally incompatible with that.
 * @param {import('exceljs').Workbook} workbook
 * @param {string[]} posIds
 * @param {Map<string, import('./parser.js').TransactionRecord[]>} filteredByPos
 * @param {Map<string, {count: number, total: number}>} resultByPos
 */
function buildTransactionsSheet(workbook, posIds, filteredByPos, resultByPos) {
  const sheet = workbook.addWorksheet('Transactions');

  const titleRow = sheet.addRow(['Transaction Report']);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, TRANSACTIONS_COL_COUNT);
  titleRow.getCell(1).font = { bold: true, size: 14 };
  sheet.addRow([]);

  let nextRow = 3;
  for (const [posA, posB] of buildPosBatches(posIds)) {
    const recordsA = filteredByPos.get(posA) || [];
    const recordsB = posB ? (filteredByPos.get(posB) || []) : [];
    const batchDataRowCount = Math.max(recordsA.length, recordsB.length);
    const rowsUsed = 4 + batchDataRowCount; // title + header + data + count + total

    writePosBlock(sheet, nextRow, 1, posA, recordsA, resultByPos.get(posA) || { count: 0, total: 0 }, batchDataRowCount);
    if (posB) {
      writePosBlock(sheet, nextRow, POS_BLOCK_B_START_COL, posB, recordsB, resultByPos.get(posB) || { count: 0, total: 0 }, batchDataRowCount);
    }

    nextRow += rowsUsed + 1; // +1 blank separator row before the next batch
  }

  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  autoSizeColumns(sheet, TRANSACTIONS_COL_COUNT);
}

/**
 * Builds the "Summary" sheet: report title, generated date/time, a
 * POS/Transactions/Total table, and Grand Total / Grand Transactions rows.
 * Has a working autoFilter on the header row since it (unlike Transactions)
 * has exactly one contiguous data range.
 * @param {import('exceljs').Workbook} workbook
 * @param {string[]} posIds
 * @param {Map<string, {count: number, total: number}>} resultByPos
 * @param {{grandTotal: number, grandCount: number}} grandSummary
 * @param {Date} generatedAt
 */
function buildSummarySheet(workbook, posIds, resultByPos, grandSummary, generatedAt) {
  const sheet = workbook.addWorksheet('Summary');
  const colCount = 3;

  const titleRow = sheet.addRow(['Paytm CSV Cleaner — Summary Report']);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, colCount);
  titleRow.getCell(1).font = { bold: true, size: 14 };

  sheet.addRow(['Generated Date:', generatedAt.toLocaleDateString('en-IN')]);
  sheet.addRow(['Generated Time:', generatedAt.toLocaleTimeString('en-IN')]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(['POS ID', 'Transaction Count', 'Total Amount']);
  const headerRowNumber = headerRow.number;
  styleHeaderRow(headerRow, colCount);

  posIds.forEach((posId, idx) => {
    const result = resultByPos.get(posId) || { count: 0, total: 0 };
    const row = sheet.addRow([posId, result.count, round2(result.total)]);
    row.getCell(3).numFmt = CURRENCY_FMT;
    for (let c = 1; c <= colCount; c += 1) {
      row.getCell(c).border = THIN_BORDER;
      if (idx % 2 === 1) row.getCell(c).fill = BAND_FILL;
    }
  });

  sheet.addRow([]);

  const grandTotalRow = sheet.addRow(['', 'Grand Total', round2(grandSummary.grandTotal)]);
  grandTotalRow.font = { bold: true };
  grandTotalRow.getCell(3).numFmt = CURRENCY_FMT;

  const grandCountRow = sheet.addRow(['', 'Grand Transactions', grandSummary.grandCount]);
  grandCountRow.font = { bold: true };

  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber + posIds.length, column: colCount },
  };
  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  autoSizeColumns(sheet, colCount);
}

/**
 * Builds the complete two-sheet XLSX workbook.
 * @param {{
 *   posIds: string[],
 *   filteredByPos: Map<string, import('./parser.js').TransactionRecord[]>,
 *   resultByPos: Map<string, {count: number, total: number}>,
 *   grandSummary: {grandTotal: number, grandCount: number},
 *   generatedAt: Date,
 * }} data
 * @returns {import('exceljs').Workbook}
 */
function buildWorkbook({ posIds, filteredByPos, resultByPos, grandSummary, generatedAt }) {
  // eslint-disable-next-line no-undef
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Paytm CSV Cleaner V2';
  workbook.created = generatedAt;

  buildTransactionsSheet(workbook, posIds, filteredByPos, resultByPos);
  buildSummarySheet(workbook, posIds, resultByPos, grandSummary, generatedAt);

  return workbook;
}

/**
 * Serializes a workbook to an .xlsx Blob.
 * @param {import('exceljs').Workbook} workbook
 * @returns {Promise<Blob>}
 */
async function workbookToBlob(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * Builds a download filename from the original CSV name and a timestamp.
 * @param {string} originalCsvName
 * @param {Date} generatedAt
 * @returns {string}
 */
function buildXlsxFilename(originalCsvName, generatedAt) {
  const base = originalCsvName.replace(/\.csv$/i, '');
  const pad2 = (n) => String(n).padStart(2, '0');
  const stamp = [
    generatedAt.getFullYear(),
    pad2(generatedAt.getMonth() + 1),
    pad2(generatedAt.getDate()),
  ].join('') + '_' + [
    pad2(generatedAt.getHours()),
    pad2(generatedAt.getMinutes()),
    pad2(generatedAt.getSeconds()),
  ].join('');
  return `${base}_cleaned_${stamp}.xlsx`;
}
