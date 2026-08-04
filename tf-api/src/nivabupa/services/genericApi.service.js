import axios from 'axios';
import config from '../config/env.js';
import { forAudit } from '../utils/sanitize.js';
import { getNivaBupaToken } from './nivabupaAuth.service.js';

// Never log a bearer token in full — a fingerprint is enough to answer the only
// question worth asking of it ("did these two calls use the same credential?"),
// without putting a live partner token in pm2's on-disk logs.
const fingerprint = (token) =>
  token ? `${token.slice(0, 8)}…${token.slice(-6)} (len=${token.length})` : '(none)';

// NivaBupa answers 429 / NBHI-IIP-INT--01 on a fraction of premium calls, and
// measurement shows it is NOT request-rate throttling: with a fixed 12s gap
// between calls the result still alternated 200/429, and every 429 came back
// after ~7.37s of Kong-reported upstream latency while every success returned in
// 2.7–5.5s. That constant is an internal timeout on their side surfacing under a
// misleading status code — no Retry-After or RateLimit-* header is sent.
//
// So the same request retried moments later normally succeeds. Two short retries
// turn a ~40% observed failure rate into a rare one, and the worst case
// (7.4 + 0.3 + 7.4 + 0.8 + 7.4 ≈ 23.3s) still lands inside the frontend's 30s
// axios timeout. Only 429 is retried: 4xx validation failures are deterministic
// and retrying them would just multiply load.
const RETRY_STATUSES = new Set([429]);
const RETRY_DELAYS_MS = [300, 800];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await axios.post(url, body, { headers, timeout: config.timeouts.api });

      if (config.nivabupa.debug) {
        console.log('────────── NivaBupa response ─────────');
        console.log('Status :', response.status);
        console.log('Attempt:', attempt + 1);
        console.log('Headers:', response.headers);
        console.log('Body   :', JSON.stringify(forAudit(response.data), null, 2));
        console.log('──────────────────────────────────────\n');
      }

      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const canRetry = RETRY_STATUSES.has(status) && attempt < RETRY_DELAYS_MS.length;

      if (canRetry) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(
          `⚠️  NivaBupa ${status} on ${url} (upstream ${error.response?.headers?.['x-kong-upstream-latency'] ?? '?'}ms) ` +
            `— retrying in ${delay}ms [attempt ${attempt + 2}/${RETRY_DELAYS_MS.length + 1}]`
        );
        await sleep(delay);
        continue;
      }

      // Logged in full whether or not debug is on. The controllers persist the
      // failure to api_transactions, but the reason a call was rejected lives in
      // error.response.data, not error.message — without this, both an upstream
      // throttle and a field-validation rejection read only as
      // "Request failed with status code NNN" in the logs.
      console.error('────────── NivaBupa call FAILED ──────');
      console.error('URL          :', url);
      console.error('attempts     :', attempt + 1);
      console.error('error.message:', error.message);
      console.error('error.code   :', error.code);
      console.error('status       :', status);
      console.error('resp headers :', error.response?.headers);
      console.error('resp data    :', JSON.stringify(forAudit(error.response?.data ?? null), null, 2));
      console.error('──────────────────────────────────────');
      throw error;
    }
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
