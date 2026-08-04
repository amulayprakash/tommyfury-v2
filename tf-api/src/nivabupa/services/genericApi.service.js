import axios from 'axios';
import config from '../config/env.js';
import { forAudit } from '../utils/sanitize.js';
import { getNivaBupaToken } from './nivabupaAuth.service.js';

// Never log a bearer token in full — a fingerprint is enough to answer the only
// question worth asking of it ("did these two calls use the same credential?"),
// without putting a live partner token in pm2's on-disk logs.
const fingerprint = (token) =>
  token ? `${token.slice(0, 8)}…${token.slice(-6)} (len=${token.length})` : '(none)';

// Premium/UW/Data Push all share the same auth (Bearer token + clientId
// header) and forwarding shape — only the target URL and body differ.
async function forwardToNivaBupa(url, body) {
  const token = await getNivaBupaToken();
  const clientId = config.nivabupa.clientId;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'clientId': clientId,
    'Content-Type': 'application/json'
  };

  if (config.nivabupa.debug) {
    console.log('\n────────── NivaBupa request ──────────');
    console.log('URL           :', url);
    console.log('Headers       :', { ...headers, Authorization: `Bearer ${fingerprint(token)}` });
    console.log('Content-Length:', Buffer.byteLength(JSON.stringify(body ?? '')));
    console.log('Payload       :', JSON.stringify(forAudit(body), null, 2));
  }

  try {
    const response = await axios.post(url, body, { headers, timeout: config.timeouts.api });

    if (config.nivabupa.debug) {
      console.log('────────── NivaBupa response ─────────');
      console.log('Status :', response.status);
      console.log('Headers:', response.headers);
      console.log('Body   :', JSON.stringify(forAudit(response.data), null, 2));
      console.log('──────────────────────────────────────\n');
    }

    return response.data;
  } catch (error) {
    // Logged in full whether or not debug is on. The controllers persist the
    // failure to api_transactions, but the reason a call was rejected lives in
    // error.response.data, not error.message — without this, both an upstream
    // throttle and a field-validation rejection read only as
    // "Request failed with status code NNN" in the logs.
    console.error('────────── NivaBupa call FAILED ──────');
    console.error('URL          :', url);
    console.error('error.message:', error.message);
    console.error('error.code   :', error.code);
    console.error('status       :', error.response?.status);
    console.error('resp headers :', error.response?.headers);
    console.error('resp data    :', JSON.stringify(forAudit(error.response?.data ?? null), null, 2));
    console.error('──────────────────────────────────────');
    throw error;
  }
}

// Pass-through: the caller sends the exact Reassure 3.0 premium request shape
// (policyTerm, coverageType, sumInsured, member[], policyAdjustmentList[], ...
// per the Premium Data Dictionary), this just attaches auth and forwards it.
function getPremium(payload) {
  return forwardToNivaBupa(config.nivabupa.premiumUrl, payload);
}

// Pass-through: caller sends the UW request shape (Proposal.POLICY / NOMINEE
// / MEMBER[] / PROPOSER, per UW request.txt) — same auth/forward mechanics
// as Premium.
function getUwDecision(payload) {
  return forwardToNivaBupa(config.nivabupa.uwDecisionUrl, payload);
}

// Pass-through: caller sends the full proposal payload (per data push
// dictionary.xlsx) — pushes it to NivaBupa and returns their
// { RESPONSE: { STATUS, POLICY_CODE, STATUS_MESSAGE } } envelope.
function submitDataPush(payload) {
  return forwardToNivaBupa(config.nivabupa.dataPushUrl, payload);
}

export { forwardToNivaBupa, getPremium, getUwDecision, submitDataPush };
