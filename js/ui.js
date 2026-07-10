/**
 * DOM rendering and event wiring. This module owns all direct DOM access;
 * it holds no business logic and only calls back into app.js handlers.
 */

/** Cached references to static DOM elements, populated by {@link cacheDom}. */
const dom = {};

/**
 * Caches references to every static element the UI touches. Must be called
 * once, after DOMContentLoaded.
 */
function cacheDom() {
  dom.alertRegion = document.getElementById('alertRegion');

  dom.dropZone = document.getElementById('dropZone');
  dom.csvFileInput = document.getElementById('csvFileInput');
  dom.fileMeta = document.getElementById('fileMeta');
  dom.fileMetaName = document.getElementById('fileMetaName');
  dom.fileMetaSize = document.getElementById('fileMetaSize');
  dom.fileMetaRows = document.getElementById('fileMetaRows');
  dom.fileMetaSkipped = document.getElementById('fileMetaSkipped');
  dom.parseProgressWrap = document.getElementById('parseProgressWrap');
  dom.parseProgressBar = document.getElementById('parseProgressBar');

  dom.summaryCard = document.getElementById('summaryCard');
  dom.summaryStats = document.getElementById('summaryStats');
  dom.summaryActions = document.getElementById('summaryActions');
  dom.emptyReportBanner = document.getElementById('emptyReportBanner');

  dom.posCardsSection = document.getElementById('posCardsSection');
  dom.posCardsContainer = document.getElementById('posCardsContainer');
  dom.resetFiltersBtn = document.getElementById('resetFiltersBtn');

  dom.generateSection = document.getElementById('generateSection');
  dom.generateXlsxBtn = document.getElementById('generateXlsxBtn');
  dom.generateProgressWrap = document.getElementById('generateProgressWrap');

  dom.darkModeToggle = document.getElementById('darkModeToggle');
  dom.darkModeToggleLabel = document.getElementById('darkModeToggleLabel');

  dom.exportCsvBtn = document.getElementById('exportCsvBtn');
  dom.exportJsonBtn = document.getElementById('exportJsonBtn');
  dom.copySummaryBtn = document.getElementById('copySummaryBtn');
  dom.printSummaryBtn = document.getElementById('printSummaryBtn');
}

/**
 * Wires the dark-mode toggle button.
 * @param {() => void} onClick
 */
function bindDarkModeToggle(onClick) {
  dom.darkModeToggle.addEventListener('click', onClick);
}

/**
 * Applies the dark/light theme to the document and updates the toggle
 * button's label and pressed state.
 * @param {boolean} isDark
 */
function setDarkModeUI(isDark) {
  document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
  dom.darkModeToggle.setAttribute('aria-pressed', String(isDark));
  dom.darkModeToggleLabel.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

/**
 * Wires the Reset Filters button.
 * @param {() => void} onClick
 */
function bindResetFiltersButton(onClick) {
  dom.resetFiltersBtn.addEventListener('click', onClick);
}

/**
 * Wires the summary panel's action buttons (export CSV/JSON, copy, print).
 * @param {{
 *   onExportCsv: () => void,
 *   onExportJson: () => void,
 *   onCopySummary: () => void,
 *   onPrintSummary: () => void,
 * }} handlers
 */
function bindSummaryActions({ onExportCsv, onExportJson, onCopySummary, onPrintSummary }) {
  dom.exportCsvBtn.addEventListener('click', onExportCsv);
  dom.exportJsonBtn.addEventListener('click', onExportJson);
  dom.copySummaryBtn.addEventListener('click', onCopySummary);
  dom.printSummaryBtn.addEventListener('click', onPrintSummary);
}

let alertCounter = 0;

/**
 * Renders a dismissible Bootstrap alert into the alert region.
 * @param {string} message
 * @param {'danger'|'warning'|'success'|'info'} [type]
 * @returns {string} the id of the created alert element, for programmatic dismissal
 */
function showAlert(message, type = 'danger') {
  alertCounter += 1;
  const id = `app-alert-${alertCounter}`;
  const wrapper = document.createElement('div');
  wrapper.className = `alert alert-${type} alert-dismissible fade show shadow-sm`;
  wrapper.id = id;
  wrapper.setAttribute('role', 'alert');
  wrapper.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-close';
  closeBtn.setAttribute('data-bs-dismiss', 'alert');
  closeBtn.setAttribute('aria-label', 'Close');
  wrapper.appendChild(closeBtn);

  dom.alertRegion.appendChild(wrapper);
  return id;
}

/**
 * Removes a specific alert by id, if still present.
 * @param {string} id
 */
function dismissAlert(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/** Clears every alert currently shown. */
function clearAlerts() {
  dom.alertRegion.replaceChildren();
}

/**
 * Wires click-to-upload and drag-and-drop behavior for the drop zone.
 * @param {(file: File) => void} onFileSelected
 */
function bindUploadEvents(onFileSelected) {
  const openPicker = () => dom.csvFileInput.click();

  // The file input is a descendant of the drop zone, so calling .click() on
  // it dispatches a synthetic click that bubbles right back up to this same
  // listener. Without this guard that's infinite reentrant recursion, which
  // makes the native file picker fail to open at all.
  dom.dropZone.addEventListener('click', (e) => {
    if (e.target === dom.csvFileInput) return;
    openPicker();
  });
  dom.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  });

  dom.csvFileInput.addEventListener('change', () => {
    const file = dom.csvFileInput.files && dom.csvFileInput.files[0];
    if (file) onFileSelected(file);
    dom.csvFileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evtName) => {
    dom.dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evtName) => {
    dom.dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.dropZone.classList.remove('drag-over');
    });
  });

  dom.dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onFileSelected(file);
  });
}

/** Shows the parse-progress spinner/bar and resets it to 0%. */
function showParseProgress() {
  dom.parseProgressWrap.classList.remove('d-none');
  setParseProgress(0);
}

/**
 * Updates the parse-progress bar fill and ARIA value.
 * @param {number} percent 0-100
 */
function setParseProgress(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  const bar = dom.parseProgressBar.querySelector('.progress-bar');
  bar.style.width = `${clamped}%`;
  dom.parseProgressBar.setAttribute('aria-valuenow', String(clamped));
}

/** Hides the parse-progress spinner/bar. */
function hideParseProgress() {
  dom.parseProgressWrap.classList.add('d-none');
}

/**
 * Renders file metadata (name/size/row count/skipped count) after parsing.
 * @param {{name: string, size: string, rowCount: number, skippedCount: number}} meta
 */
function renderFileMeta(meta) {
  dom.fileMeta.classList.remove('d-none');
  dom.fileMetaName.textContent = `📄 ${meta.name}`;
  dom.fileMetaSize.textContent = `💾 ${meta.size}`;
  dom.fileMetaRows.textContent = `🧾 ${meta.rowCount.toLocaleString('en-IN')} rows`;

  if (meta.skippedCount > 0) {
    dom.fileMetaSkipped.textContent = `⚠️ ${meta.skippedCount.toLocaleString('en-IN')} row(s) skipped`;
    dom.fileMetaSkipped.classList.remove('d-none');
  } else {
    dom.fileMetaSkipped.classList.add('d-none');
  }
}

/** Hides and clears the file metadata badges. */
function resetFileMeta() {
  dom.fileMeta.classList.add('d-none');
  dom.fileMetaSkipped.classList.add('d-none');
}

/**
 * Converts a POS_ID into a string safe for use as an HTML id/name fragment.
 * @param {string} posId
 * @returns {string}
 */
function sanitizeDomId(posId) {
  return posId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Builds the markup for a single POS card: read-only stats (earliest/
 * latest transaction) plus the business-day preset and date/time filter
 * controls. Filter interactivity is wired separately (see filters.js /
 * app.js); this function only produces structure and initial values.
 * @param {string} posId
 * @param {{earliest: Date|null, latest: Date|null, count: number, total: number}} stats
 * @returns {string} HTML string for the card's containing column
 */
function buildPosCardHtml(posId, stats, selected) {
  const safeId = sanitizeDomId(posId);
  return `
    <div class="col-12 col-md-6 col-xl-4">
      <div class="pos-card card h-100${selected ? '' : ' is-excluded'}" data-pos-id="${escapeHtml(posId)}" id="pos-card-${safeId}">
        <div class="card-body d-flex flex-column">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h3 class="pos-card-header h6 mb-0">${escapeHtml(posId)}</h3>
            <div class="form-check form-switch mb-0">
              <input
                type="checkbox"
                class="form-check-input pos-include-checkbox"
                id="include-${safeId}"
                ${selected ? 'checked' : ''}
              />
              <label class="form-check-label small" for="include-${safeId}">Include in XLSX</label>
            </div>
          </div>

          <div class="pos-readonly-row mb-3">
            <div>First Transaction: <strong>${formatDateTimeDisplay(stats.earliest)}</strong></div>
            <div>Last Transaction: <strong>${formatDateTimeDisplay(stats.latest)}</strong></div>
          </div>

          <div class="mb-3">
            <span class="form-label small d-block mb-1">Business Day</span>
            <div class="btn-group w-100" role="group" aria-label="Business day preset for ${escapeHtml(posId)}">
              <input type="radio" class="btn-check pos-preset-radio" name="preset-${safeId}" id="preset-6am-${safeId}" value="6am" autocomplete="off" checked />
              <label class="btn btn-outline-primary btn-sm" for="preset-6am-${safeId}">6AM→6AM</label>

              <input type="radio" class="btn-check pos-preset-radio" name="preset-${safeId}" id="preset-8am-${safeId}" value="8am" autocomplete="off" />
              <label class="btn btn-outline-primary btn-sm" for="preset-8am-${safeId}">8AM→8AM</label>

              <input type="radio" class="btn-check pos-preset-radio" name="preset-${safeId}" id="preset-custom-${safeId}" value="custom" autocomplete="off" />
              <label class="btn btn-outline-primary btn-sm" for="preset-custom-${safeId}">Custom</label>
            </div>
          </div>

          <div class="row g-2 mb-2">
            <div class="col-6">
              <label class="form-label small" for="start-date-${safeId}">Start Date</label>
              <input type="date" class="form-control form-control-sm pos-start-date" id="start-date-${safeId}" />
            </div>
            <div class="col-6">
              <label class="form-label small" for="start-time-${safeId}">Start Time</label>
              <input type="time" class="form-control form-control-sm pos-start-time" id="start-time-${safeId}" />
            </div>
            <div class="col-6">
              <label class="form-label small" for="end-date-${safeId}">End Date</label>
              <input type="date" class="form-control form-control-sm pos-end-date" id="end-date-${safeId}" />
            </div>
            <div class="col-6">
              <label class="form-label small" for="end-time-${safeId}">End Time</label>
              <input type="time" class="form-control form-control-sm pos-end-time" id="end-time-${safeId}" />
            </div>
          </div>

          <div class="pos-card-alert small text-danger d-none mb-2" role="alert"></div>

          <div class="pos-card-footer d-flex justify-content-between border-top pt-2 mt-auto">
            <div>Count: <span class="pos-live-count">${stats.count.toLocaleString('en-IN')}</span></div>
            <div>Total: <span class="pos-live-total">${formatCurrency(stats.total)}</span></div>
          </div>

          <div class="pos-stats-row small text-muted d-flex justify-content-between mt-1">
            <span>Avg: <span class="pos-stat-avg">—</span></span>
            <span>High: <span class="pos-stat-high">—</span></span>
            <span>Low: <span class="pos-stat-low">—</span></span>
          </div>

          <button
            type="button"
            class="btn btn-sm btn-outline-secondary w-100 mt-2"
            data-bs-toggle="collapse"
            data-bs-target="#pos-tx-${safeId}"
            aria-expanded="false"
            aria-controls="pos-tx-${safeId}"
          >
            View Transactions
          </button>

          <div class="collapse mt-2" id="pos-tx-${safeId}">
            <input
              type="search"
              class="form-control form-control-sm pos-tx-search mb-2"
              placeholder="Search date, POS, or amount…"
              aria-label="Search transactions for ${escapeHtml(posId)}"
            />
            <div class="table-responsive pos-tx-table-wrap">
              <table class="table table-sm table-hover align-middle mb-1">
                <thead>
                  <tr>
                    <th scope="col" class="pos-tx-sort-date" role="button" tabindex="0" aria-label="Sort by date">Date <span class="pos-tx-sort-indicator">▲</span></th>
                    <th scope="col">POS</th>
                    <th scope="col" class="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody class="pos-tx-tbody"></tbody>
              </table>
            </div>
            <p class="small text-muted pos-tx-caption mb-0"></p>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Wires the Generate XLSX button's click handler.
 * @param {() => void} onClick
 */
function bindGenerateButton(onClick) {
  dom.generateXlsxBtn.addEventListener('click', onClick);
}

/** Shows the XLSX-generation progress bar and disables the generate button. */
function showGenerateProgress() {
  dom.generateProgressWrap.classList.remove('d-none');
  dom.generateXlsxBtn.disabled = true;
}

/** Hides the XLSX-generation progress bar and re-enables the generate button. */
function hideGenerateProgress() {
  dom.generateProgressWrap.classList.add('d-none');
  dom.generateXlsxBtn.disabled = false;
}

/**
 * Renders the always-visible summary panel: grand total, grand transaction
 * count, and generated time. Shows/hides the empty-report banner based on
 * `emptyReport`.
 * @param {{grandTotal: number, grandCount: number, generatedTime: string, emptyReport: boolean}} summary
 */
function renderSummary({ grandTotal, grandCount, generatedTime, emptyReport }) {
  dom.summaryCard.classList.remove('d-none');

  dom.summaryStats.innerHTML = `
    <div class="col-6 col-lg-4">
      <div class="stat-tile">
        <div class="stat-label">Grand Total</div>
        <div class="stat-value">${formatCurrency(grandTotal)}</div>
      </div>
    </div>
    <div class="col-6 col-lg-4">
      <div class="stat-tile">
        <div class="stat-label">Grand Transactions</div>
        <div class="stat-value">${grandCount.toLocaleString('en-IN')}</div>
      </div>
    </div>
    <div class="col-6 col-lg-4">
      <div class="stat-tile">
        <div class="stat-label">Generated</div>
        <div class="stat-value stat-value-sm">${generatedTime}</div>
      </div>
    </div>
  `;

  dom.emptyReportBanner.classList.toggle('d-none', !emptyReport);
}

/** Hides the summary panel and clears its content. */
function resetSummary() {
  dom.summaryCard.classList.add('d-none');
  dom.summaryStats.innerHTML = '';
  dom.emptyReportBanner.classList.add('d-none');
}

/**
 * Escapes a string for safe interpolation into innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Renders one card per POS into the POS cards container and reveals the
 * section. Replaces any previously rendered cards.
 * @param {string[]} posIds
 * @param {Map<string, {earliest: Date|null, latest: Date|null, count: number, total: number}>} statsByPos
 * @param {Set<string>} selectedPosIds - POS ids whose "Include in XLSX" checkbox starts checked.
 */
function renderPosCards(posIds, statsByPos, selectedPosIds) {
  const html = posIds
    .map((posId) => buildPosCardHtml(posId, statsByPos.get(posId), selectedPosIds.has(posId)))
    .join('');
  dom.posCardsContainer.innerHTML = html;
  dom.posCardsSection.classList.remove('d-none');
  dom.generateSection.classList.remove('d-none');
}

/** Hides the POS cards and generate sections and clears their content. */
function resetPosCards() {
  dom.posCardsContainer.innerHTML = '';
  dom.posCardsSection.classList.add('d-none');
  dom.generateSection.classList.add('d-none');
}

/**
 * Returns the cached element references for one POS card's controls.
 * @param {string} posId
 * @returns {{
 *   card: HTMLElement, alert: HTMLElement,
 *   startDate: HTMLInputElement, startTime: HTMLInputElement,
 *   endDate: HTMLInputElement, endTime: HTMLInputElement,
 *   presetRadios: NodeListOf<HTMLInputElement>,
 *   includeCheckbox: HTMLInputElement,
 *   liveCount: HTMLElement, liveTotal: HTMLElement,
 * }}
 */
function getPosCardRefs(posId) {
  const safeId = sanitizeDomId(posId);
  const card = document.getElementById(`pos-card-${safeId}`);
  return {
    card,
    alert: card.querySelector('.pos-card-alert'),
    startDate: document.getElementById(`start-date-${safeId}`),
    startTime: document.getElementById(`start-time-${safeId}`),
    endDate: document.getElementById(`end-date-${safeId}`),
    endTime: document.getElementById(`end-time-${safeId}`),
    presetRadios: card.querySelectorAll('.pos-preset-radio'),
    includeCheckbox: document.getElementById(`include-${safeId}`),
    liveCount: card.querySelector('.pos-live-count'),
    liveTotal: card.querySelector('.pos-live-total'),
    statAvg: card.querySelector('.pos-stat-avg'),
    statHigh: card.querySelector('.pos-stat-high'),
    statLow: card.querySelector('.pos-stat-low'),
    txCollapse: card.querySelector(`#pos-tx-${safeId}`),
    txSearch: card.querySelector('.pos-tx-search'),
    txTbody: card.querySelector('.pos-tx-tbody'),
    txCaption: card.querySelector('.pos-tx-caption'),
    txSortHeader: card.querySelector('.pos-tx-sort-date'),
    txSortIndicator: card.querySelector('.pos-tx-sort-indicator'),
  };
}

/**
 * Wires the preset radios, the four date/time fields, and the "Include in
 * XLSX" checkbox for one POS card.
 * @param {string} posId
 * @param {{
 *   onPresetChange: (posId: string, preset: string) => void,
 *   onFieldChange: (posId: string) => void,
 *   onSelectionChange: (posId: string, selected: boolean) => void,
 * }} handlers
 */
function bindPosCardEvents(posId, { onPresetChange, onFieldChange, onSelectionChange }) {
  const refs = getPosCardRefs(posId);

  refs.presetRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) onPresetChange(posId, radio.value);
    });
  });

  [refs.startDate, refs.startTime, refs.endDate, refs.endTime].forEach((input) => {
    input.addEventListener('input', () => onFieldChange(posId));
  });

  refs.includeCheckbox.addEventListener('change', () => {
    onSelectionChange(posId, refs.includeCheckbox.checked);
  });
}

/**
 * Sets a POS card's "Include in XLSX" checkbox state and toggles the
 * card's dimmed/excluded visual style to match.
 * @param {string} posId
 * @param {boolean} selected
 */
function setPosCardSelected(posId, selected) {
  const refs = getPosCardRefs(posId);
  refs.includeCheckbox.checked = selected;
  refs.card.classList.toggle('is-excluded', !selected);
}

/**
 * Sets the four date/time field values for a POS card without emitting
 * change events (used for preset-driven and programmatic updates).
 * @param {string} posId
 * @param {{startDate: string, startTime: string, endDate: string, endTime: string}} values
 */
function setPosCardDateTime(posId, values) {
  const refs = getPosCardRefs(posId);
  refs.startDate.value = values.startDate;
  refs.startTime.value = values.startTime;
  refs.endDate.value = values.endDate;
  refs.endTime.value = values.endTime;
}

/**
 * Reads the current raw string values of a POS card's four date/time fields.
 * @param {string} posId
 * @returns {{startDate: string, startTime: string, endDate: string, endTime: string}}
 */
function getPosCardDateTime(posId) {
  const refs = getPosCardRefs(posId);
  return {
    startDate: refs.startDate.value,
    startTime: refs.startTime.value,
    endDate: refs.endDate.value,
    endTime: refs.endTime.value,
  };
}

/**
 * Sets which preset radio is checked for a POS card.
 * @param {string} posId
 * @param {'6am'|'8am'|'custom'} preset
 */
function setPosPreset(posId, preset) {
  const refs = getPosCardRefs(posId);
  refs.presetRadios.forEach((radio) => {
    radio.checked = radio.value === preset;
  });
}

/**
 * Updates the live count/total figures shown in a POS card's footer.
 * @param {string} posId
 * @param {string} countText
 * @param {string} totalText
 */
function setPosLiveStats(posId, countText, totalText) {
  const refs = getPosCardRefs(posId);
  refs.liveCount.textContent = countText;
  refs.liveTotal.textContent = totalText;
}

/**
 * Updates the average/highest/lowest transaction figures for a POS card.
 * @param {string} posId
 * @param {{avg: string, high: string, low: string}} stats
 */
function setPosStats(posId, { avg, high, low }) {
  const refs = getPosCardRefs(posId);
  refs.statAvg.textContent = avg;
  refs.statHigh.textContent = high;
  refs.statLow.textContent = low;
}

/**
 * Wires the search box and sortable Date header inside a POS card's
 * transaction viewer, plus listeners that track whether the panel is
 * currently expanded (so the caller can keep it live-updated) and render
 * it fresh each time it's opened.
 * @param {string} posId
 * @param {{
 *   onShow: (posId: string) => void,
 *   onHide: (posId: string) => void,
 *   onSearch: (posId: string, term: string) => void,
 *   onSortToggle: (posId: string) => void,
 * }} handlers
 */
function bindPosTransactionViewer(posId, { onShow, onHide, onSearch, onSortToggle }) {
  const refs = getPosCardRefs(posId);

  refs.txCollapse.addEventListener('show.bs.collapse', () => onShow(posId));
  refs.txCollapse.addEventListener('hide.bs.collapse', () => onHide(posId));
  refs.txSearch.addEventListener('input', () => onSearch(posId, refs.txSearch.value));
  refs.txSortHeader.addEventListener('click', () => onSortToggle(posId));
  refs.txSortHeader.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSortToggle(posId);
    }
  });
}

/**
 * Renders rows into a POS card's transaction table.
 * @param {string} posId
 * @param {Array<{dateText: string, posId: string, amountText: string}>} rows
 * @param {number} matchedCount - Total rows matching the current search (before capping).
 * @param {number} cap - The render cap that was applied.
 * @param {'asc'|'desc'} sortDir
 */
function renderPosTransactionRows(posId, rows, matchedCount, cap, sortDir) {
  const refs = getPosCardRefs(posId);
  refs.txTbody.innerHTML = rows
    .map((r) => `<tr><td>${escapeHtml(r.dateText)}</td><td>${escapeHtml(r.posId)}</td><td class="text-end">${escapeHtml(r.amountText)}</td></tr>`)
    .join('');

  refs.txCaption.textContent = matchedCount > cap
    ? `Showing first ${cap.toLocaleString('en-IN')} of ${matchedCount.toLocaleString('en-IN')} matching transactions. Narrow your search or filter to see more.`
    : `${matchedCount.toLocaleString('en-IN')} transaction(s).`;

  refs.txSortIndicator.textContent = sortDir === 'asc' ? '▲' : '▼';
}

/**
 * Shows or clears a validation error on a POS card.
 * @param {string} posId
 * @param {string|null} reason - Error message, or null/empty to clear.
 */
function setPosCardValidity(posId, reason) {
  const refs = getPosCardRefs(posId);
  if (reason) {
    refs.card.classList.add('is-invalid');
    refs.alert.textContent = reason;
    refs.alert.classList.remove('d-none');
  } else {
    refs.card.classList.remove('is-invalid');
    refs.alert.textContent = '';
    refs.alert.classList.add('d-none');
  }
}

/**
 * Public namespace for this module, used by app.js. Loaded as a classic
 * (non-module) script so the app can run by opening index.html directly —
 * no local server required — without hitting the file:// CORS restriction
 * that blocks `<script type="module">` imports.
 */
window.ui = {
  cacheDom,
  bindDarkModeToggle,
  setDarkModeUI,
  bindResetFiltersButton,
  bindSummaryActions,
  showAlert,
  dismissAlert,
  clearAlerts,
  bindUploadEvents,
  showParseProgress,
  setParseProgress,
  hideParseProgress,
  renderFileMeta,
  resetFileMeta,
  sanitizeDomId,
  bindGenerateButton,
  showGenerateProgress,
  hideGenerateProgress,
  renderSummary,
  resetSummary,
  renderPosCards,
  resetPosCards,
  getPosCardRefs,
  bindPosCardEvents,
  setPosCardDateTime,
  getPosCardDateTime,
  setPosPreset,
  setPosLiveStats,
  setPosStats,
  bindPosTransactionViewer,
  renderPosTransactionRows,
  setPosCardValidity,
  setPosCardSelected,
};
