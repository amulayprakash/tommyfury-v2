'use strict';

require('dotenv').config();

/**
 * Pehchaan (e-KYC) configuration — kept entirely SEPARATE from the motor
 * integration config. Different service, different base URL, different auth
 * (an api_key that mints a short-lived JWT), so it gets its own module.
 *
 * Flow:
 *   #0   GET /tgt/generate-token            (header api_key) -> { token, ttl }
 *   #1.2 GET /primary/kyc-verified          (header token, query pan/dob/...)
 *   #1.2.1 GET /partner/corporate/kyc       (corporate)
 *   #1.3 GET /primary/kyc-status/:kycId
 *   #1.4 GET /primary/kyc-status/transaction-id/:txnId
 *
 * The verified KYC response carries kyc_id + proposer details; only when
 * iskycVerified === 1 may a policy be issued (feed kyc_id into the motor
 * proposal's Customer_Pehchaan_id).
 */

const KYC_BASE_URL =
  process.env.HDFC_KYC_BASE_URL || 'https://ekyc-uat.hdfcergo.com/e-kyc';

const KYC_API_KEY = process.env.HDFC_KYC_API_KEY || '';

// JWT TTL is ~10 min; refresh a bit early. Value in ms.
const KYC_TOKEN_TTL_MS =
  (parseInt(process.env.HDFC_KYC_TOKEN_TTL, 10) || 480) * 1000; // 8 min default

const ENDPOINTS = {
  generateToken: '/tgt/generate-token',
  fetchKyc: '/primary/kyc-verified',
  corporateKyc: '/partner/corporate/kyc',
  statusByKycId: '/primary/kyc-status', //   + /:kycId
  statusByTxnId: '/primary/kyc-status/transaction-id', // + /:txnId
};

function url(pathKey, suffix = '') {
  const base = KYC_BASE_URL.replace(/\/?$/, '');
  return base + ENDPOINTS[pathKey] + (suffix ? `/${suffix}` : '');
}

module.exports = {
  KYC_BASE_URL,
  KYC_API_KEY,
  KYC_TOKEN_TTL_MS,
  ENDPOINTS,
  url,
};
