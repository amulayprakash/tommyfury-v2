'use strict';

const axios = require('axios');
const kcfg = require('../config/kyc');
const { HdfcError } = require('../utils/helpers');

/**
 * Pehchaan e-KYC service — independent from hdfcService (motor). Maintains its
 * own JWT token cache (minted from api_key, ~10-min TTL).
 */

const http = axios.create({ timeout: 30000, validateStatus: () => true });

let tokenEntry = { token: null, fetchedAt: 0 };

function tokenIsFresh() {
  return tokenEntry.token && Date.now() - tokenEntry.fetchedAt < kcfg.KYC_TOKEN_TTL_MS;
}

/* ----------------------------- #0 Token -------------------------------- */
async function generateToken({ force = false } = {}) {
  if (!force && tokenIsFresh()) return tokenEntry.token;
  if (!kcfg.KYC_API_KEY) {
    throw new HdfcError('KYC api_key not configured (set HDFC_KYC_API_KEY)', { step: 'kycToken' });
  }
  const res = await http.get(kcfg.url('generateToken'), {
    headers: { api_key: kcfg.KYC_API_KEY },
  });
  // HDFC actual shape: { success, data: { token, expiry } }. Also accept a
  // flat { token } just in case. Expiry may be an epoch (seconds).
  const body = res.data || {};
  const token = body.data?.token ?? body.token ?? null;
  const expiry = body.data?.expiry ?? body.expiry ?? null;
  if (!token) {
    throw new HdfcError('KYC token generation failed', {
      step: 'kycToken', statusCode: res.status, hdfc: res.data,
    });
  }
  // Derive ttl (seconds) from epoch expiry when present, else default.
  let ttl = res.data?.ttl;
  if (!ttl && expiry) ttl = Math.max(30, Number(expiry) - Math.floor(Date.now() / 1000));
  tokenEntry = { token, fetchedAt: Date.now(), ttl };
  return token;
}

async function ensureToken() {
  if (!tokenIsFresh()) await generateToken({ force: true });
  return tokenEntry.token;
}

/* ------------------------- #1.2 Fetch KYC ------------------------------ */
/**
 * Look up an existing verified KYC. Pass any accepted combination as `params`
 * (pan+dob preferred, or name+mobile, kyc_id+dob, aadhaar_uid+dob, txn_id, ...).
 * `redirect_url` should be your frontend return page.
 *
 * Returns the raw HDFC body. Two shapes:
 *  - Found & verified: { status:true, data:{ iskycVerified:1, kyc_id, name, dob,
 *      permanentAddress, permanentPincode, email, pan, status:"approved", ... } }
 *  - Not found: a redirection link (+ txn_id) to run the Pehchaan journey.
 */
async function fetchKyc(params = {}) {
  await ensureToken();
  const query = normalizeParams(params);
  const res = await http.get(kcfg.url('fetchKyc'), {
    headers: { token: tokenEntry.token },
    params: query,
  });
  if (res.status === 401) {
    // token expired mid-flight — refresh once and retry
    await generateToken({ force: true });
    const retry = await http.get(kcfg.url('fetchKyc'), {
      headers: { token: tokenEntry.token }, params: query,
    });
    return retry.data;
  }
  return res.data;
}

/* --------------------- #1.2.1 Corporate KYC ---------------------------- */
async function fetchCorporateKyc(params = {}) {
  await ensureToken();
  const query = normalizeCorporateParams(params);
  const res = await http.get(kcfg.url('corporateKyc'), {
    headers: { token: tokenEntry.token },
    params: query,
  });
  return res.data;
}

/* --------------------- #1.3 Status by kycId ---------------------------- */
async function statusByKycId(kycId) {
  await ensureToken();
  const res = await http.get(kcfg.url('statusByKycId', kycId), {
    headers: { token: tokenEntry.token },
  });
  return res.data;
}

/* --------------------- #1.4 Status by txnId ---------------------------- */
async function statusByTxnId(txnId) {
  await ensureToken();
  const res = await http.get(kcfg.url('statusByTxnId', txnId), {
    headers: { token: tokenEntry.token },
  });
  return res.data;
}

/* ------------------------------ helpers -------------------------------- */
// Only forward params HDFC recognizes; all keys lowercase.
const ALLOWED = [
  'pan', 'dob', 'mobile', 'name', 'kyc_id', 'ckyc_number', 'aadhaar_uid',
  'agent_id', 'passport_number', 'driving_licence', 'gc_cust_id', 'eia_number',
  'email_address', 'redirect_url', 'txn_id', 'callback_url',
];
function normalizeParams(p) {
  const out = {};
  for (const k of ALLOWED) {
    const v = p[k] ?? p[camel(k)];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

const ALLOWED_CORP = ['ent_cin', 'doi', 'ent_ckycnum', 'ent_pan', 'txn_id', 'redirect_url', 'ent_type'];
function normalizeCorporateParams(p) {
  const out = {};
  for (const k of ALLOWED_CORP) {
    const v = p[k] ?? p[camel(k)];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function camel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Convenience: is this fetch/status response a verified KYC? */
function isVerified(body) {
  const d = body?.data ?? body;
  return Number(d?.iskycVerified) === 1 || d?.status === 'approved';
}

/** Convenience: pull proposer fields from a verified fetch response, mapped to
 *  the motor proposal Customer_Details naming. */
function toProposer(body) {
  const d = body?.data ?? body ?? {};
  return {
    pehchaanId: d.kyc_id ?? null,
    kycId: d.kyc_id ?? null,
    kycVerified: Number(d.iskycVerified) === 1,
    name: d.name ?? null,
    dob: d.dob ?? null, // already DD/MM/YYYY
    email: d.email ?? '',
    mobile: d.mobile ?? '',
    panNo: d.pan ?? '',
    permAddress1: d.permanentAddress ?? '',
    permCityDistrict: d.permanentCity ?? '',
    permPinCode: d.permanentPincode ?? '',
    mailingAddress1: d.correspondenceAddress ?? d.permanentAddress ?? '',
    mailingCityDistrict: d.correspondenceCity ?? d.permanentCity ?? '',
    mailingPinCode: d.correspondencePincode ?? d.permanentPincode ?? '',
    status: d.status ?? null,
  };
}

module.exports = {
  generateToken,
  ensureToken,
  fetchKyc,
  fetchCorporateKyc,
  statusByKycId,
  statusByTxnId,
  isVerified,
  toProposer,
  _tokenEntry: () => tokenEntry,
};
