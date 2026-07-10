# Paytm CSV Cleaner V2

A production-quality, dashboard-style web app for turning a raw Paytm POS CSV export into a professionally formatted, per-POS-reconciled XLSX report — entirely in the browser. No backend, no build step, no server. Open `index.html` directly (double-click it) or host it on GitHub Pages.

## Features

- **CSV import** — click-to-upload or drag & drop, with a live parsing progress bar, filename/size/row-count display, and graceful skipping (with a count) of rows with a missing/invalid date, amount, or POS_ID. Handles UTF-8 BOM, quoted commas, escaped quotes, Excel's leading-apostrophe date artifact, and comma-thousands amounts. Tested at 100,000+ rows.
- **Automatic POS detection** — every unique `POS_ID` in the file gets its own card; nothing is hardcoded, so `PUMP-01`, `FASTAG`, `QR`, `UPI`, or any other POS name just works.
- **Per-POS business-day filters** — each POS card has independent Start/End date & time fields plus a preset selector (`6AM→6AM`, `8AM→8AM`, `Custom`). Presets anchor to that POS's earliest transaction (see [Business-day algorithm](#business-day-algorithm) below); manually editing a field while a preset is active automatically switches that card to Custom without losing the edit.
- **Per-POS "Include in XLSX" selection** — each card has a checkbox controlling whether that POS is included in the generated report; pump 1 / pump 2 (however formatted — `PUMP-01`, `PUMP-1`, etc.) are selected by default, everything else starts unselected. This only scopes the Generate XLSX output — filters, live preview, and the transaction viewer keep working normally for excluded POS too. Reset Filters restores the default selection.
- **Live preview** — every filter change instantly recomputes that POS's transaction count, total, and average/highest/lowest amount, plus the grand summary — no button, no re-parsing. Backed by an O(log n) binary-search + prefix-sum design so it stays responsive at 100k+ rows.
- **Always-visible summary panel** — Grand Total, Grand Transaction Count, and a Generated timestamp.
- **Validation** — non-blocking Bootstrap alerts (not `window.alert`) for End-before-Start, invalid/missing dates, and an empty report; an invalid POS card is visually flagged and excluded from the grand summary until fixed.
- **XLSX generation** — a two-sheet workbook: **Transactions** (POS ids shown two at a time, side by side — `PUMP-01`/`PUMP-02` paired first when both are present, then every other POS batched in twos — each with its own header, sorted rows, count, and total) and **Summary** (per-POS table + grand totals), with dark-blue bold-white headers, borders, currency formatting, banded rows, frozen header rows, and an autofilter on the Summary sheet.
- **Dark mode**, with the choice persisted.
- **LocalStorage persistence** of dark mode, the last-used business-day preset, and per-POS custom filter values (restored only when the same POS id reappears in a new file — see [Filter persistence rules](#filter-persistence-rules)).
- **Bonus tools**: per-POS searchable & sortable transaction viewer, Export Filtered CSV, Export Summary JSON, Copy Summary (to clipboard), Print Summary, Reset Filters, and per-POS average/highest/lowest transaction stats.

## Installation

This is a static site with no dependencies to install — all third-party libraries (Bootstrap 5, PapaParse, ExcelJS, FileSaver.js) load from a CDN, and the app's own code loads as classic (non-module) scripts specifically so it works over `file://`.

**Just double-click `index.html`.** No build step, no local server required.

If you'd rather serve it (e.g. to match how it'll behave on GitHub Pages), any static file server works:

```bash
cd paytm-parser
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Usage

1. **Upload a CSV** — click the upload card or drag a file onto it. The file must contain `Transaction_Date`, `POS_ID`, and `Amount` columns (extra columns are ignored but preserved for CSV export).
2. **Review the auto-detected POS cards** — each shows its first/last transaction, and starts on the 6AM→6AM business-day preset.
3. **Adjust filters** — switch presets or edit the date/time fields directly per POS. The live count/total update immediately.
4. **Check the summary panel** for grand totals and validation alerts.
5. **Generate XLSX** — click the button once every POS card is valid; the file downloads automatically.
6. Optionally use the transaction viewer (search/sort), CSV/JSON export, copy/print summary, or dark mode as needed.

## Business-day algorithm

For a preset with rollover hour `H` (6 or 8), each POS's window is anchored to *that POS's own earliest transaction* (not "today" and not the file's global range, so re-opening an old CSV gives the same result every time):

1. Take local midnight of the earliest transaction's calendar date, then add `H:00:00` → `candidateStart`.
2. If the earliest transaction is *before* `candidateStart`, it actually belongs to the previous business day, so `businessDayStart = candidateStart − 1 day`; otherwise `businessDayStart = candidateStart`.
3. `businessDayEnd = businessDayStart + 1 day`.

Choosing a preset always recomputes and overwrites the four fields for that POS. Editing a field manually while on a preset flips that card to Custom (keeping the edited value) rather than silently reverting it on the next recompute.

## Filter persistence rules

LocalStorage stores dark mode, the most-recently-used preset, and a map of per-POS custom values. On loading a (possibly different) CSV:

- If the saved preset is `6am`/`8am`, every POS starts from that preset, recomputed fresh from the new file (stale saved dates are never reused).
- If the saved preset was `custom`, a POS restores its saved values **only if its id exactly matches** a saved entry; any POS without a match falls back to the `6am` default.

## Known limitation

The **Transactions** sheet repeats a column-header row for every POS batch, which is structurally incompatible with Excel's single-filter-range-per-sheet model — so no autofilter is applied there (the **Summary** sheet, which has one contiguous table, does have a working autofilter).

## Architecture

```mermaid
flowchart TD
    A[index.html] --> B[app.js<br/>state + orchestration]
    B --> C[parser.js<br/>PapaParse wrapper, cleaning]
    B --> D[analyzer.js<br/>group by POS, stats]
    B --> E[filters.js<br/>business-day windows,<br/>O(log n) aggregation]
    B --> F[excel.js<br/>ExcelJS workbook build]
    B --> G[ui.js<br/>DOM render + events]
    C --> H[utils.js<br/>debounce, formatting,<br/>binary search, storage]
    D --> H
    E --> H
    F --> H
    G --> H
```

| File | Responsibility |
|---|---|
| `index.html` | Bootstrap 5 dashboard shell; loads PapaParse/ExcelJS/FileSaver via CDN, then every `js/*.js` file as a classic script in dependency order. |
| `css/styles.css` | Light/dark theme variables (synced to Bootstrap's `data-bs-theme`), card/drop-zone/table styling, print stylesheet. |
| `js/app.js` | Module-level state, initialization, and every event handler tying the other modules together. |
| `js/parser.js` | PapaParse wrapper; date/amount cleaning and validation. |
| `js/analyzer.js` | Groups records by POS into sorted arrays + prefix sums; computes read-only stats. |
| `js/filters.js` | Business-day window computation, O(log n) filtered aggregation, grand summary, CSV row serialization. |
| `js/excel.js` | Builds the styled two-sheet XLSX workbook via ExcelJS. |
| `js/ui.js` | All DOM rendering and event wiring — no business logic. |
| `js/utils.js` | Shared helpers: debounce, currency/date formatting, binary search, CSV escaping, safe localStorage, clipboard. |

## Deploying to GitHub Pages

A workflow at `.github/workflows/pages.yml` deploys this static site automatically on every push to `main`, using `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages` (no build step — the repo root is served as-is).

To enable it on a new repository:

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually via **Actions → Deploy to GitHub Pages → Run workflow**).
4. The deployed URL appears in the workflow run summary and in **Settings → Pages**.

## Screenshots

_Add screenshots of the upload flow, POS cards with live filters, dark mode, and a generated XLSX here once the app is deployed._

## Performance

Parsing and rendering 120,000+ transaction rows across 5 POS ids completes in well under half a second, and per-keystroke live-preview recomputation completes in single-digit milliseconds, thanks to sorting each POS's records once at load time and using prefix sums + binary search for range queries instead of re-scanning on every filter change.
