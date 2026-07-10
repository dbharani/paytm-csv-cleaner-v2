/**
 * Application entry point and orchestration. Owns the single module-level
 * `state` object and wires DOM events (via ui.js) to pure computation
 * (parser.js / analyzer.js / filters.js / excel.js).
 *
 * Loaded as a classic (non-module) script — see index.html for the required
 * load order (utils, parser, analyzer, filters, excel, ui, then this file)
 * — so every function referenced below (parseCsvFile, buildPosMap,
 * formatCurrency, ui.*, etc.) comes from the shared global scope those
 * scripts populate, rather than from ES module imports. This lets the app
 * run by opening index.html directly, with no local server and no
 * cross-origin module-loading restriction.
 */

const PRESET_HOURS = { '6am': 6, '8am': 8 };
const STORAGE_KEY = 'paytmCsvCleanerV2';
const TX_RENDER_CAP = 500;

/** @type {{
 *   fileMeta: {name: string, size: number, rowCount: number, skippedCount: number} | null,
 *   headers: string[],
 *   allRecords: import('./parser.js').TransactionRecord[],
 *   posMap: Map<string, import('./parser.js').TransactionRecord[]>,
 *   prefixSums: Map<string, number[]>,
 *   posIds: string[],
 *   posStats: Map<string, {earliest: Date|null, latest: Date|null, count: number, total: number}>,
 *   filters: Map<string, {preset: '6am'|'8am'|'custom'}>,
 *   lastComputed: Map<string, {count: number, total: number, valid: boolean, lo: number, hi: number}>,
 *   txViewerState: Map<string, {searchTerm: string, sortDir: 'asc'|'desc', isOpen: boolean}>,
 *   selectedPosIds: Set<string>,
 *   darkMode: boolean,
 *   lastPreset: '6am'|'8am'|'custom',
 *   customValuesByPosId: Record<string, {startDate: string, startTime: string, endDate: string, endTime: string}>,
 * }}
 */
const state = {
  fileMeta: null,
  headers: [],
  allRecords: [],
  posMap: new Map(),
  prefixSums: new Map(),
  posIds: [],
  posStats: new Map(),
  filters: new Map(),
  lastComputed: new Map(),
  txViewerState: new Map(),
  selectedPosIds: new Set(),
  darkMode: false,
  lastPreset: '6am',
  customValuesByPosId: {},
};

/**
 * Computes the default "Include in XLSX" selection for a freshly loaded
 * file's POS ids: pump 1 and pump 2 (however they're formatted — see
 * {@link pumpNumber}) are selected when present; nothing else is, so a
 * file without any pump POS starts with an empty selection and the user
 * must explicitly choose what to include.
 * @param {string[]} posIds
 * @returns {Set<string>}
 */
function computeDefaultSelection(posIds) {
  return new Set(posIds.filter((posId) => {
    const n = pumpNumber(posId);
    return n === 1 || n === 2;
  }));
}

/**
 * Loads persisted dark-mode/preset/custom-filter preferences from
 * localStorage into state (called once, before the first file is loaded).
 */
function loadPersistedPreferences() {
  const saved = readLocalStorage(STORAGE_KEY, {});
  state.darkMode = Boolean(saved.darkMode);
  state.lastPreset = saved.lastPreset || '6am';
  state.customValuesByPosId = saved.customValuesByPosId || {};
}

/** Writes the current dark-mode/preset/custom-filter preferences to localStorage. */
function savePersistedPreferences() {
  writeLocalStorage(STORAGE_KEY, {
    darkMode: state.darkMode,
    lastPreset: state.lastPreset,
    customValuesByPosId: state.customValuesByPosId,
  });
}

/**
 * Handles a newly selected/dropped CSV file: parses it, updates state, and
 * renders the resulting metadata (or an error alert on failure).
 * @param {File} file
 */
async function handleFileSelected(file) {
  ui.clearAlerts();
  ui.resetFileMeta();
  ui.resetPosCards();
  ui.resetSummary();
  state.filters.clear();
  state.lastComputed.clear();

  if (!/\.csv$/i.test(file.name)) {
    ui.showAlert('Please select a .csv file.', 'warning');
    return;
  }

  ui.showParseProgress();

  try {
    const { records, headers, rowCount, skippedCount } = await parseCsvFile(file, ({ percent }) => {
      ui.setParseProgress(percent);
    });

    state.headers = headers;
    state.allRecords = records;
    state.fileMeta = {
      name: file.name,
      size: file.size,
      rowCount,
      skippedCount,
    };

    ui.renderFileMeta({
      name: file.name,
      size: formatFileSize(file.size),
      rowCount,
      skippedCount,
    });

    if (skippedCount > 0) {
      ui.showAlert(
        `${skippedCount.toLocaleString('en-IN')} row(s) were skipped due to a missing/invalid date, amount, or POS_ID.`,
        'warning',
      );
    }

    if (records.length === 0) {
      ui.showAlert('No valid transactions were found in this file.', 'danger');
      return;
    }

    const { posMap, prefixSums, posIds } = buildPosMap(records);
    state.posMap = posMap;
    state.prefixSums = prefixSums;
    state.posIds = posIds;

    state.posStats = new Map(posIds.map((posId) => [posId, computePosStats(posMap.get(posId))]));
    state.selectedPosIds = computeDefaultSelection(posIds);

    ui.renderPosCards(posIds, state.posStats, state.selectedPosIds);
    initPosFilters(posIds);
  } catch (err) {
    ui.showAlert(`Failed to parse CSV: ${err.message}`, 'danger');
  } finally {
    ui.hideParseProgress();
  }
}

/**
 * Sets up filter state and event bindings for every rendered POS card,
 * restoring the last-used preset/custom values from localStorage per the
 * documented rules, then runs an initial live-preview computation.
 *
 * If the last global preset was '6am'/'8am', every POS starts from that
 * preset (stale saved dates are never reused — always recomputed fresh
 * from the new file's data). If it was 'custom', a POS restores its saved
 * custom values only when its id exactly matches a saved entry; any POS
 * without a match falls back to the '6am' default.
 * @param {string[]} posIds
 */
function initPosFilters(posIds) {
  for (const posId of posIds) {
    state.filters.set(posId, { preset: '6am' });
    state.txViewerState.set(posId, { searchTerm: '', sortDir: 'asc', isOpen: false });

    ui.bindPosCardEvents(posId, {
      onPresetChange: handlePresetChange,
      onFieldChange: debounce(handleFieldChange, 150),
      onSelectionChange: handleSelectionChange,
    });
    ui.bindPosTransactionViewer(posId, {
      onShow: handleTxShow,
      onHide: handleTxHide,
      onSearch: debounce(handleTxSearch, 150),
      onSortToggle: handleTxSortToggle,
    });

    if (state.lastPreset === 'custom') {
      const saved = state.customValuesByPosId[posId];
      const start = saved && combineInputDateTime(saved.startDate, saved.startTime);
      const end = saved && combineInputDateTime(saved.endDate, saved.endTime);
      if (saved && start && end) {
        state.filters.set(posId, { preset: 'custom' });
        ui.setPosPreset(posId, 'custom');
        ui.setPosCardDateTime(posId, saved);
        recomputeAndRenderPos(posId);
        continue;
      }
    }
    applyPreset(posId, state.lastPreset === 'custom' ? '6am' : state.lastPreset, { persist: false });
  }
}

/**
 * Applies a business-day preset to a POS card: recomputes Start/End from
 * the POS's earliest transaction and overwrites the visible fields. For
 * 'custom', this only updates the stored preset — field values are left
 * untouched.
 * @param {string} posId
 * @param {'6am'|'8am'|'custom'} preset
 * @param {{persist?: boolean}} [options] - Set persist:false during initial restore-from-storage to avoid overwriting the just-loaded preference with the per-card default.
 */
function applyPreset(posId, preset, { persist = true } = {}) {
  state.filters.set(posId, { preset });
  ui.setPosPreset(posId, preset);

  if (preset !== 'custom') {
    const { start, end } = computeBusinessDayWindow(state.posMap.get(posId), PRESET_HOURS[preset]);
    ui.setPosCardDateTime(posId, {
      startDate: dateToInputDate(start),
      startTime: dateToInputTime(start),
      endDate: dateToInputDate(end),
      endTime: dateToInputTime(end),
    });
  }

  if (persist) {
    state.lastPreset = preset;
    savePersistedPreferences();
  }

  recomputeAndRenderPos(posId);
}

/**
 * Handler for a preset radio change: always recomputes and overwrites the
 * date/time fields for that POS (the explicit, expected effect of choosing
 * a preset).
 * @param {string} posId
 * @param {string} preset
 */
function handlePresetChange(posId, preset) {
  applyPreset(posId, preset);
}

/**
 * Handler for a manual edit to any of a POS card's date/time fields. If a
 * non-Custom preset is currently active, this implicitly flips it to
 * Custom (without wiping the field the user just edited) before
 * recomputing the live preview. Custom values are persisted per-POS so
 * they can be restored the next time this exact POS id reappears.
 * @param {string} posId
 */
function handleFieldChange(posId) {
  const current = state.filters.get(posId);
  if (current && current.preset !== 'custom') {
    state.filters.set(posId, { preset: 'custom' });
    ui.setPosPreset(posId, 'custom');
  }

  state.lastPreset = 'custom';
  state.customValuesByPosId[posId] = ui.getPosCardDateTime(posId);
  savePersistedPreferences();

  recomputeAndRenderPos(posId);
}

/**
 * Handler for a POS card's "Include in XLSX" checkbox: updates the
 * selection set and the card's dimmed/excluded visual state. Purely a
 * Generate XLSX concern — live preview, filters, and the transaction
 * viewer keep working for unselected POS exactly as before.
 * @param {string} posId
 * @param {boolean} selected
 */
function handleSelectionChange(posId, selected) {
  if (selected) {
    state.selectedPosIds.add(posId);
  } else {
    state.selectedPosIds.delete(posId);
  }
  ui.setPosCardSelected(posId, selected);
}

/**
 * Resets every POS card back to the default 6AM→6AM business-day preset,
 * clears persisted custom filter values, and restores the default
 * pump-1/pump-2 XLSX selection.
 */
function handleResetFilters() {
  state.customValuesByPosId = {};
  state.lastPreset = '6am';
  savePersistedPreferences();
  for (const posId of state.posIds) {
    applyPreset(posId, '6am', { persist: false });
  }

  state.selectedPosIds = computeDefaultSelection(state.posIds);
  for (const posId of state.posIds) {
    ui.setPosCardSelected(posId, state.selectedPosIds.has(posId));
  }

  ui.showAlert('Filters reset to the default 6AM→6AM business day for every POS.', 'success');
}

/**
 * Reads a POS card's current field values, validates them, and updates its
 * live count/total (or shows a validation message) — O(log n), no re-parse.
 * @param {string} posId
 */
function recomputeAndRenderPos(posId) {
  const { startDate, startTime, endDate, endTime } = ui.getPosCardDateTime(posId);
  const start = combineInputDateTime(startDate, startTime);
  const end = combineInputDateTime(endDate, endTime);

  const validation = validateFilterRange(start, end);
  if (!validation.valid) {
    ui.setPosCardValidity(posId, validation.reason);
    ui.setPosLiveStats(posId, '—', '—');
    ui.setPosStats(posId, { avg: '—', high: '—', low: '—' });
    state.lastComputed.set(posId, { count: 0, total: 0, valid: false, lo: 0, hi: 0 });
    updateSummary();
    return;
  }

  ui.setPosCardValidity(posId, null);
  const posRecords = state.posMap.get(posId);
  const prefixSums = state.prefixSums.get(posId);
  const result = recomputePos(posRecords, prefixSums, start, end);

  ui.setPosLiveStats(posId, result.count.toLocaleString('en-IN'), formatCurrency(result.total));

  const rangeStats = computePosRangeStats(posRecords, result.lo, result.hi);
  ui.setPosStats(posId, rangeStats
    ? { avg: formatCurrency(rangeStats.avg), high: formatCurrency(rangeStats.high), low: formatCurrency(rangeStats.low) }
    : { avg: '—', high: '—', low: '—' });

  state.lastComputed.set(posId, { ...result, valid: true });

  if (state.txViewerState.get(posId)?.isOpen) renderPosTransactions(posId);

  updateSummary();
}

/**
 * Handler for a POS card's transaction viewer being expanded: marks it
 * open and renders its current filtered rows.
 * @param {string} posId
 */
function handleTxShow(posId) {
  state.txViewerState.get(posId).isOpen = true;
  renderPosTransactions(posId);
}

/**
 * Handler for a POS card's transaction viewer being collapsed: marks it
 * closed so subsequent filter changes skip re-rendering its (hidden) table.
 * @param {string} posId
 */
function handleTxHide(posId) {
  state.txViewerState.get(posId).isOpen = false;
}

/**
 * Handler for typing in a POS card's transaction search box.
 * @param {string} posId
 * @param {string} term
 */
function handleTxSearch(posId, term) {
  state.txViewerState.get(posId).searchTerm = term;
  renderPosTransactions(posId);
}

/**
 * Handler for clicking the Date column header: toggles sort direction.
 * @param {string} posId
 */
function handleTxSortToggle(posId) {
  const viewerState = state.txViewerState.get(posId);
  viewerState.sortDir = viewerState.sortDir === 'asc' ? 'desc' : 'asc';
  renderPosTransactions(posId);
}

/**
 * Filters (by search term, matched against date/POS/amount text) and
 * sorts (by date) a POS's currently-filtered transactions, then renders
 * up to {@link TX_RENDER_CAP} rows into its transaction table. The
 * underlying `posRecords` slice is already date-sorted ascending, so an
 * ascending render requires no extra sort — only descending does.
 * @param {string} posId
 */
function renderPosTransactions(posId) {
  const computed = state.lastComputed.get(posId);
  const viewerState = state.txViewerState.get(posId);
  if (!computed || !computed.valid) {
    ui.renderPosTransactionRows(posId, [], 0, TX_RENDER_CAP, viewerState.sortDir);
    return;
  }

  const posRecords = state.posMap.get(posId);
  const slice = posRecords.slice(computed.lo, computed.hi);
  const term = viewerState.searchTerm.trim().toLowerCase();

  const matched = term
    ? slice.filter((r) => (
      r.dateRaw.toLowerCase().includes(term)
      || r.posId.toLowerCase().includes(term)
      || String(r.amount).includes(term)
    ))
    : slice;

  if (viewerState.sortDir === 'desc') matched.reverse();

  const rows = matched.slice(0, TX_RENDER_CAP).map((r) => ({
    dateText: formatDateTimeDisplay(r.date),
    posId: r.posId,
    amountText: formatCurrency(r.amount),
  }));

  ui.renderPosTransactionRows(posId, rows, matched.length, TX_RENDER_CAP, viewerState.sortDir);
}

/**
 * Recomputes and renders the always-visible summary panel from the current
 * `state.lastComputed` snapshot (each POS card's last valid/invalid result).
 */
function updateSummary() {
  const { grandTotal, grandCount } = computeGrandSummary(state.lastComputed);
  ui.renderSummary({
    grandTotal,
    grandCount,
    generatedTime: formatDateTimeDisplay(new Date()),
    emptyReport: grandCount === 0,
  });
}

/**
 * Handles the Generate XLSX button click: validates the current filter
 * state, builds the workbook, and triggers a download. Blocks generation
 * (with a Bootstrap alert, not a blocking dialog) on any invalid POS range
 * or an entirely empty report.
 */
async function handleGenerateXlsx() {
  ui.clearAlerts();

  const selectedPosIds = state.posIds.filter((posId) => state.selectedPosIds.has(posId));
  if (selectedPosIds.length === 0) {
    ui.showAlert('Select at least one POS ("Include in XLSX") to generate a report.', 'danger');
    return;
  }

  const invalidPosIds = selectedPosIds.filter((posId) => !state.lastComputed.get(posId)?.valid);
  if (invalidPosIds.length > 0) {
    ui.showAlert(
      `Fix the invalid date range on: ${invalidPosIds.join(', ')} before generating the report.`,
      'danger',
    );
    return;
  }

  const selectedComputed = new Map(selectedPosIds.map((posId) => [posId, state.lastComputed.get(posId)]));
  const { grandTotal, grandCount } = computeGrandSummary(selectedComputed);
  if (grandCount === 0) {
    ui.showAlert('Cannot generate an empty report — no transactions fall within the selected ranges.', 'danger');
    return;
  }

  ui.showGenerateProgress();
  try {
    const filteredByPos = new Map();
    const resultByPos = new Map();
    for (const posId of selectedPosIds) {
      const { lo, hi } = state.lastComputed.get(posId);
      filteredByPos.set(posId, state.posMap.get(posId).slice(lo, hi));
      resultByPos.set(posId, state.lastComputed.get(posId));
    }

    const generatedAt = new Date();
    const workbook = buildWorkbook({
      posIds: selectedPosIds,
      filteredByPos,
      resultByPos,
      grandSummary: { grandTotal, grandCount },
      generatedAt,
    });
    const blob = await workbookToBlob(workbook);
    const filename = buildXlsxFilename(state.fileMeta.name, generatedAt);

    // eslint-disable-next-line no-undef
    saveAs(blob, filename);
    ui.showAlert(`Report generated: ${filename}`, 'success');
  } catch (err) {
    ui.showAlert(`Failed to generate XLSX: ${err.message}`, 'danger');
  } finally {
    ui.hideGenerateProgress();
  }
}

/** Toggles dark mode, applies it, and persists the preference. */
function handleDarkModeToggle() {
  state.darkMode = !state.darkMode;
  ui.setDarkModeUI(state.darkMode);
  savePersistedPreferences();
}

/**
 * Exports every valid POS's currently-filtered transactions as a single
 * combined CSV (one header row, all POS interleaved by their own filtered
 * order) and triggers a download.
 */
function handleExportCsv() {
  if (state.posIds.length === 0) return;

  const lines = [toCsvRow(['Transaction_Date', 'POS_ID', 'Amount'])];
  for (const posId of state.posIds) {
    const computed = state.lastComputed.get(posId);
    if (!computed || !computed.valid) continue;
    const posRecords = state.posMap.get(posId);
    lines.push(...filteredRecordsToCsvRows(posRecords, computed.lo, computed.hi));
  }

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const base = state.fileMeta.name.replace(/\.csv$/i, '');
  // eslint-disable-next-line no-undef
  saveAs(blob, `${base}_filtered.csv`);
}

/** Exports the current summary (grand totals + per-POS breakdown) as a JSON file. */
function handleExportJson() {
  if (state.posIds.length === 0) return;

  const { grandTotal, grandCount } = computeGrandSummary(state.lastComputed);
  const generatedAt = new Date();

  const summary = {
    generatedAt: generatedAt.toISOString(),
    sourceFile: state.fileMeta.name,
    grandTotal: round2(grandTotal),
    grandTransactionCount: grandCount,
    perPos: state.posIds.map((posId) => {
      const computed = state.lastComputed.get(posId) || { count: 0, total: 0, valid: false };
      return { posId, count: computed.count, total: round2(computed.total), valid: computed.valid };
    }),
  };

  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
  const base = state.fileMeta.name.replace(/\.csv$/i, '');
  // eslint-disable-next-line no-undef
  saveAs(blob, `${base}_summary.json`);
}

/** Copies a plain-text rendition of the summary panel to the clipboard. */
async function handleCopySummary() {
  const { grandTotal, grandCount } = computeGrandSummary(state.lastComputed);

  const lines = [
    'Paytm CSV Cleaner V2 — Summary',
    `Generated: ${formatDateTimeDisplay(new Date())}`,
    '',
    ...state.posIds.map((posId) => {
      const computed = state.lastComputed.get(posId) || { count: 0, total: 0 };
      return `${posId}: ${computed.count.toLocaleString('en-IN')} txns, ${formatCurrency(computed.total)}`;
    }),
    '',
    `Grand Total: ${formatCurrency(grandTotal)}`,
    `Grand Transactions: ${grandCount.toLocaleString('en-IN')}`,
  ];

  const ok = await copyToClipboard(lines.join('\n'));
  ui.showAlert(ok ? 'Summary copied to clipboard.' : 'Could not copy to clipboard.', ok ? 'success' : 'danger');
}

/** Opens the browser print dialog (the print stylesheet shows only the summary panel). */
function handlePrintSummary() {
  window.print();
}

/** Initializes the application: caches DOM, wires events, and restores preferences. */
function init() {
  ui.cacheDom();
  loadPersistedPreferences();
  ui.setDarkModeUI(state.darkMode);

  ui.bindUploadEvents(handleFileSelected);
  ui.bindGenerateButton(handleGenerateXlsx);
  ui.bindDarkModeToggle(handleDarkModeToggle);
  ui.bindResetFiltersButton(handleResetFilters);
  ui.bindSummaryActions({
    onExportCsv: handleExportCsv,
    onExportJson: handleExportJson,
    onCopySummary: handleCopySummary,
    onPrintSummary: handlePrintSummary,
  });
}

document.addEventListener('DOMContentLoaded', init);
