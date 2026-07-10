/**
 * Shared utility helpers used across the app: debouncing, formatting,
 * binary search, CSV escaping, and safe localStorage/clipboard access.
 */

/**
 * Returns a debounced version of `fn` that only runs after `ms` milliseconds
 * of inactivity.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Rounds a currency amount to 2 decimal places, avoiding the floating-point
 * summation noise (e.g. 38699.200000000004) that binary IEEE-754 addition
 * accumulates over many rows.
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Normalizes a POS id to detect "pump 1" / "pump 2" regardless of exact
 * source formatting — case, separator style (`-`, `_`, space, none), and
 * leading zeros all vary across Paytm exports (`PUMP-01`, `PUMP-1`,
 * `Pump_1`, `PUMP1`, …). Returns `1`, `2`, or `null` if `id` isn't a pump
 * POS at all. Used both to pair pump POS side by side in the XLSX export
 * and to default-select them for inclusion in the report.
 * @param {string} id
 * @returns {1|2|null}
 */
function pumpNumber(id) {
  const match = id.trim().match(/^PUMP[-_\s]*0*([12])$/i);
  return match ? Number(match[1]) : null;
}

/**
 * Formats a number as Indian-Rupee currency, e.g. 1234.5 -> "₹1,234.50".
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  if (!Number.isFinite(value)) return '₹0.00';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Formats a plain number with thousands separators (no currency symbol).
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-IN').format(value);
}

/**
 * Formats a Date for display, e.g. "09 Jul 2026, 06:23:11 AM".
 * @param {Date} date
 * @returns {string}
 */
function formatDateTimeDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Pads a number to 2 digits, e.g. 5 -> "05".
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Converts a Date to the value expected by an `<input type="date">`.
 * @param {Date} date
 * @returns {string} "YYYY-MM-DD"
 */
function dateToInputDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Converts a Date to the value expected by an `<input type="time">`.
 * @param {Date} date
 * @returns {string} "HH:MM"
 */
function dateToInputTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Combines separate date-input and time-input string values into a Date.
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {string} timeStr "HH:MM"
 * @returns {Date|null} null if either input is empty/invalid
 */
function combineInputDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Finds the first index in a sorted array whose key is >= target
 * (a standard "lower bound" binary search).
 * @param {Array<T>} arr - Array sorted ascending by `keyFn`.
 * @param {number} target
 * @param {(item: T) => number} keyFn
 * @returns {number} index in [0, arr.length]
 * @template T
 */
function lowerBound(arr, target, keyFn) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keyFn(arr[mid]) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Escapes a single field for safe inclusion in a CSV row.
 * @param {string|number} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Joins an array of field values into a single CSV row line.
 * @param {Array<string|number>} fields
 * @returns {string}
 */
function toCsvRow(fields) {
  return fields.map(escapeCsvField).join(',');
}

/**
 * Safely reads and JSON-parses a localStorage key, returning `fallback` on
 * any error (quota, disabled storage, malformed JSON, etc).
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
function readLocalStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Safely JSON-serializes and writes a value to localStorage, silently
 * no-op-ing on any error.
 * @param {string} key
 * @param {*} value
 */
function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled or quota exceeded; persistence is a nice-to-have.
  }
}

/**
 * Copies text to the clipboard, using the modern async API when available.
 * @param {string} text
 * @returns {Promise<boolean>} whether the copy succeeded
 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy method.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Formats a byte count as a human-readable string, e.g. 1536 -> "1.5 KB".
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
