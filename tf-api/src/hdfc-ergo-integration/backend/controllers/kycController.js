'use strict';

const kyc = require('../services/kycService');

/**
 * Pehchaan KYC controller. Thin HTTP layer over kycService. Kept separate from
 * motorController so the two integrations never entangle.
 */

/** GET /api/kyc/token — mint (or reuse) a Pehchaan JWT. Mostly for debugging. */
async function token(req, res, next) {
  try {
    const t = await kyc.generateToken({ force: req.query.force === 'true' });
    res.json({ success: true, token: t });
  } catch (err) { next(err); }
}

/**
 * POST /api/kyc/fetch — look up existing KYC by any accepted combo.
 * Body: { pan, dob, mobile, name, kyc_id, aadhaar_uid, redirect_url, ... }
 * Returns HDFC body plus a normalized `proposer` (when verified) and, when not
 * found, the redirection link the frontend should open.
 */
async function fetch(req, res, next) {
  try {
    const body = await kyc.fetchKyc(req.body || {});
    const verified = kyc.isVerified(body);
    res.json({
      success: true,
      verified,
      proposer: verified ? kyc.toProposer(body) : null,
      // Pehchaan returns a redirect/pre-signed URL + txn_id when KYC must be done
      redirect: !verified ? extractRedirect(body) : null,
      response: body,
    });
  } catch (err) { next(err); }
}

/** POST /api/kyc/corporate — corporate (non-individual) KYC fetch. */
async function corporate(req, res, next) {
  try {
    const body = await kyc.fetchCorporateKyc(req.body || {});
    const verified = kyc.isVerified(body);
    res.json({
      success: true,
      verified,
      proposer: verified ? kyc.toProposer(body) : null,
      redirect: !verified ? extractRedirect(body) : null,
      response: body,
    });
  } catch (err) { next(err); }
}

/** GET /api/kyc/status/:kycId — poll status after the Pehchaan journey. */
async function statusByKycId(req, res, next) {
  try {
    const body = await kyc.statusByKycId(req.params.kycId);
    res.json({ success: true, verified: kyc.isVerified(body), response: body });
  } catch (err) { next(err); }
}

/** GET /api/kyc/status-by-txn/:txnId — poll status by transaction id. */
async function statusByTxnId(req, res, next) {
  try {
    const body = await kyc.statusByTxnId(req.params.txnId);
    res.json({ success: true, verified: kyc.isVerified(body), response: body });
  } catch (err) { next(err); }
}

/* Pull a redirection link out of whatever field HDFC used (varies by env). */
function extractRedirect(body) {
  const d = body?.data ?? body ?? {};
  const link =
    d.redirect_link || d.redirectLink || d.redirection_link ||
    d.redirectionLink || d.url || d.link || null;
  const txnId = d.txn_id || d.txnId || null;
  if (!link && !txnId) return null;
  return { link, txnId };
}

module.exports = {
  token,
  fetch,
  corporate,
  statusByKycId,
  statusByTxnId,
};
