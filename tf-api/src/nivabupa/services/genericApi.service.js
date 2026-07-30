import axios from 'axios';
import config from '../config/env.js';
import { getNivaBupaToken } from './nivabupaAuth.service.js';

// Premium/UW/Data Push all share the same auth (Bearer token + clientId
// header) and forwarding shape — only the target URL and body differ.
async function forwardToNivaBupa(url, body) {
  const token = await getNivaBupaToken();
  const clientId = config.nivabupa.clientId;

  const response = await axios.post(url, body, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'clientId': clientId,
      'Content-Type': 'application/json'
    },
    timeout: config.timeouts.api
  });

  return response.data;
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
