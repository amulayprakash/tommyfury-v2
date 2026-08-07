'use strict';

const axios = require('axios');
const cfg = require('../config/hdfc');
const {
  generateTransactionId,
  normalizeHdfcResponse,
  isSuccess,
  HdfcError,
} = require('../utils/helpers');

/**
 * Token cache keyed by product (lob + optional commercial sub-type), because
 * GCV and PCV may carry different product codes and therefore different tokens.
 *   tokenCache["pvtcar"] / tokenCache["commercial:gcv"] = { token, fetchedAt }
 */
const tokenCache = Object.create(null);

const http = axios.create({
  timeout: 45000,
  validateStatus: () => true, // HDFC UAT can return non-2xx with a useful body
});

function cacheKey(lob, subType) {
  return subType ? `${lob}:${subType}` : lob;
}

/** Build channel headers. `withToken` toggles auth vs data calls. */
function buildHeaders(lob, subType, { withToken = true, transactionId } = {}) {
  const product = cfg.getProduct(lob, subType); // resolves the right PRODUCT_CODE
  const headers = {
    'Content-Type': 'application/json',
    SOURCE: cfg.CHANNEL.source,
    CHANNEL_ID: cfg.CHANNEL.channelId,
    PRODUCT_CODE: product.productCode,
  };
  if (withToken) {
    headers.TOKEN = getCachedTokenOrThrow(lob, subType);
  } else {
    // Authenticate: needs CREDENTIAL + a NON-EMPTY unique TRANSACTIONID.
    headers.CREDENTIAL = cfg.CHANNEL.credential;
    headers.TRANSACTIONID = transactionId || generateTransactionId('AUTH');
  }
  return headers;
}

function getCachedTokenOrThrow(lob, subType) {
  const entry = tokenCache[cacheKey(lob, subType)];
  if (!entry || !entry.token) {
    throw new HdfcError('No cached token; call authenticate() first', { step: 'token' });
  }
  return entry.token;
}

function tokenIsFresh(lob, subType) {
  const entry = tokenCache[cacheKey(lob, subType)];
  if (!entry || !entry.token) return false;
  return Date.now() - entry.fetchedAt < cfg.TOKEN_TTL_MS;
}

/** Low-level POST with normalized response + error surfacing. */
async function post(lob, subType, endpointName, body, step) {
  const url = cfg.endpointUrl(lob, endpointName, subType);
  const headers = buildHeaders(lob, subType, { withToken: true });

  // Debug: log exactly what we send HDFC and what comes back. Turn on with
  // ENABLE_DEBUG_PAYLOAD=true in .env. Helps diagnose "BUSINESS EXCEPTION".
  const debug = process.env.ENABLE_DEBUG_PAYLOAD === 'true';
  if (debug) {
    console.log(`\n===== HDFC ${step} REQUEST =====`);
    console.log('URL:', url);
    console.log('PRODUCT_CODE:', headers.PRODUCT_CODE);
    console.log('BODY:', JSON.stringify(body, null, 2));
  }

  const res = await http.post(url, body, { headers });
  const norm = normalizeHdfcResponse(res.data);

  if (debug) {
    console.log(`===== HDFC ${step} RESPONSE (HTTP ${res.status}) =====`);
    console.log(JSON.stringify(res.data, null, 2));
    console.log('=====================================\n');
  }

  if (!isSuccess(norm.statusCode) && norm.error) {
    throw new HdfcError(norm.error || `HDFC ${step} failed`, {
      step,
      statusCode: norm.statusCode,
      hdfc: norm.data,
    });
  }
  return norm;
}

/* ---------------------------- 01 Authenticate --------------------------- */
async function authenticate(lob, opts = {}) {
  const { subType, force = false } = opts;
  const key = cacheKey(lob, subType);
  if (!force && tokenIsFresh(lob, subType)) return tokenCache[key].token;

  const url = cfg.endpointUrl(lob, 'authenticate', subType);
  const transactionId = generateTransactionId('AUTH');
  const headers = buildHeaders(lob, subType, { withToken: false, transactionId });

  const res = await http.get(url, { headers }); // Authenticate is GET, empty body
  const norm = normalizeHdfcResponse(res.data);

  const token =
    res.data?.Authentication?.Token ??
    res.data?.authentication?.token ??
    res.data?.Token ??
    null;

  if (!token) {
    throw new HdfcError('Authentication failed: no token returned', {
      step: 'authenticate',
      statusCode: norm.statusCode,
      hdfc: res.data,
    });
  }
  tokenCache[key] = { token, fetchedAt: Date.now() };
  return token;
}

/** Ensure a valid token exists before a data call. */
async function ensureToken(lob, subType) {
  if (!tokenIsFresh(lob, subType)) await authenticate(lob, { subType, force: true });
  return tokenCache[cacheKey(lob, subType)].token;
}

/* ---------------- Steps 02-07 (+ renewal), all sub-type aware ----------- */
async function getCalculateIDV(lob, payload, opts = {}) {
  await ensureToken(lob, opts.subType);
  return post(lob, opts.subType, 'getCalculateIDV', payload, 'getCalculateIDV');
}
async function calculatePremium(lob, payload, opts = {}) {
  await ensureToken(lob, opts.subType);
  return post(lob, opts.subType, 'calculatePremium', payload, 'calculatePremium');
}
async function createProposal(lob, payload, opts = {}) {
  await ensureToken(lob, opts.subType);
  return post(lob, opts.subType, 'createProposal', payload, 'createProposal');
}
async function getProposalDocument(lob, payload, opts = {}) {
  await ensureToken(lob, opts.subType);
  return post(lob, opts.subType, 'getProposalDocument', payload, 'getProposalDocument');
}
async function submitPaymentDetails(lob, payload, opts = {}) {
  await ensureToken(lob, opts.subType);
  return post(lob, opts.subType, 'submitPaymentDetails', payload, 'submitPaymentDetails');
}
async function getPolicyDocument(lob, payload, opts = {}) {
  await ensureToken(lob, opts.subType);
  return post(lob, opts.subType, 'getPolicyDocument', payload, 'getPolicyDocument');
}
async function renewalExtract(lob, payload, opts = {}) {
  await ensureToken(lob, opts.subType);
  return post(lob, opts.subType, 'renewalExtract', payload, 'renewalExtract');
}

module.exports = {
  authenticate,
  ensureToken,
  getCalculateIDV,
  calculatePremium,
  createProposal,
  getProposalDocument,
  submitPaymentDetails,
  getPolicyDocument,
  renewalExtract,
  _tokenCache: tokenCache,
};
