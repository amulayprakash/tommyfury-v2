import axios from 'axios';
import config from '../config/env.js';
import { getNivaBupaCaseApiToken } from './caseApiAuth.service.js';

// Proposal Status / Policy Download share the caseapi token (access_token
// header, not Authorization) — separate from genericApi.service.js's
// forwardToNivaBupa, which is only for the /api/generic/* family's OAuth token.
async function forwardToCaseApi(url, body) {
  const accessToken = await getNivaBupaCaseApiToken();

  const response = await axios.post(url, body, {
    headers: {
      'access_token': accessToken,
      'Content-Type': 'application/json'
    },
    timeout: config.timeouts.api
  });

  return response.data;
}

// Pass-through: caller sends { ApplicationNumber, MobileNumber } (per
// 24_PROPOSAL_STATUS_POLICY_DOWNLOAD.txt) — returns NivaBupa's
// { Status, StatusMessage, preIssuanceStatusData: [...] } envelope.
function getProposalStatus(payload) {
  return forwardToCaseApi(config.nivabupa.caseApi.proposalStatusUrl, payload);
}

// Document_Head/Document_Type are fixed per the doc ("Hardcode value"), not
// caller-supplied. Response is forwarded as-is; the exact JSON key wrapping
// the base64 PDF isn't shown in the kit (only "Response will be in Base 64
// format" — no sample), so the frontend has to handle whatever shape actually
// comes back on first live call.
function downloadPolicy(policyNumber) {
  return forwardToCaseApi(config.nivabupa.caseApi.policyDownloadUrl, {
    PolicyNumber: policyNumber,
    Document_Head: '1',
    Document_Type: '6'
  });
}

export { forwardToCaseApi, getProposalStatus, downloadPolicy };
