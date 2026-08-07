'use strict';

/**
 * HDFC ERGO expects dates as DD/MM/YYYY strings throughout.
 * Accepts a Date, an ISO string, or an already-DD/MM/YYYY string.
 */
function toHdfcDate(input) {
  if (!input) return null;
  if (typeof input === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function addDays(dateInput, days) {
  const d = dateInput instanceof Date ? new Date(dateInput) : new Date(dateInput);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * HDFC requires a unique alphanumeric TRANSACTIONID on every request,
 * especially the Authenticate header (a recurring integration pitfall:
 * missing TRANSACTIONID => auth fails). Never send an empty one.
 */
function generateTransactionId(prefix = 'TF') {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
  return `${prefix}${ts}${rand}`;
}

// Normalize whatever HDFC returns (they are inconsistent with casing) so the
// controller layer always sees {statusCode, error, warning, data}.
function normalizeHdfcResponse(raw) {
  if (raw == null || typeof raw !== 'object') return { statusCode: null, raw };
  const statusCode =
    raw.StatusCode ?? raw.statusCode ?? raw.Status ?? raw.status ?? null;
  const error = raw.Error ?? raw.error ?? null;
  const warning = raw.Warning ?? raw.warning ?? null;
  return { statusCode, error, warning, data: raw };
}

function isSuccess(statusCode) {
  if (statusCode == null) return false;
  const s = String(statusCode).trim();
  // HDFC uses "1" / 200 / "200" for success across endpoints.
  return s === '1' || s === '200' || s === 'true' || s.toUpperCase() === 'SUCCESS';
}

class HdfcError extends Error {
  constructor(message, { step, statusCode, hdfc } = {}) {
    super(message);
    this.name = 'HdfcError';
    this.step = step;
    this.statusCode = statusCode;
    this.hdfc = hdfc;
  }
}

module.exports = {
  toHdfcDate,
  addDays,
  generateTransactionId,
  normalizeHdfcResponse,
  isSuccess,
  HdfcError,
};
