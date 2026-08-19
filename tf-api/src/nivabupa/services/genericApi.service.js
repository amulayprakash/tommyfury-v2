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
// misleading status code — no Retry-After or RateLimit-* header is sent, and the
// body is their own premium envelope (STATUS "False", empty ErrorList), which a
// real gateway throttle would never carry.
//
// So the same request retried moments later normally succeeds. Only 429 is
// retried: 4xx validation failures are deterministic and retrying them would
// just multiply load.
const RETRY_STATUSES = new Set([429]);

// Longer and jittered, replacing a first pass at 300/800ms. Since the failure is
// an upstream stall rather than a token bucket, a retry that lands 300ms later
// re-enters an engine that is still stuck; the delay has to give it room to
// drain, and the jitter keeps the four concurrent tier calls a search fires from
// retrying in lockstep. Worst case 7.4 + ~1.3 + 7.4 + ~3.9 + 7.4 ≈ 27s: inside
// this service's own 20s per-attempt timeout and the frontend's 60s one.
const RETRY_BASE_DELAYS_MS = [1000, 3000];
const jitter = (ms) => Math.round(ms * (0.7 + Math.random() * 0.6));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The envelope key differs per endpoint (premiumResponse / RESPONSE / bare), so
// look in whichever one is present rather than assuming premium's.
const upstreamMessageCode = (data) => {
  const envelope = data?.premiumResponse || data?.RESPONSE || data;
  return envelope?.STATUS_MESSAGE?.[0]?.MESSAGE_CODE || null;
};

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
    console.log('Method        :', 'POST');
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
      const upstreamMs = error.response?.headers?.['x-kong-upstream-latency'];
      const canRetry = RETRY_STATUSES.has(status) && attempt < RETRY_BASE_DELAYS_MS.length;

      if (canRetry) {
        const delay = jitter(RETRY_BASE_DELAYS_MS[attempt]);
        console.warn(
          `⚠️  NivaBupa ${status} on ${url} (upstream ${upstreamMs ?? '?'}ms, ` +
            `code ${upstreamMessageCode(error.response?.data) ?? 'none'}) ` +
            `— retrying in ${delay}ms [attempt ${attempt + 2}/${RETRY_BASE_DELAYS_MS.length + 1}]`
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

      // A 429 that survived every retry must not be reported as a rate limit,
      // because it is not one (see the RETRY_STATUSES note above). axios's own
      // message — "Request failed with status code 429" — is all the controllers
      // have to put in the caller's `message` field, and it has repeatedly sent
      // people hunting for throttling, a bad token or a malformed payload when
      // the cause is an intermittent stall inside NivaBupa's pricing engine.
      // Replace the message with what actually happened and keep `.response`
      // intact so the controllers still persist and forward NivaBupa's own body
      // unchanged.
      if (RETRY_STATUSES.has(status)) {
        const code = upstreamMessageCode(error.response?.data);
        const wrapped = new Error(
          `Niva Bupa could not price this request: their gateway answered ${status} on all ` +
            `${attempt + 1} attempts${code ? ` (${code})` : ''}` +
            `${upstreamMs ? `, ~${upstreamMs}ms upstream` : ''}. ` +
            'This is an intermittent internal timeout on their side — not a rate limit, ' +
            'not a rejected payload. The same request usually succeeds on a fresh try.'
        );
        wrapped.response = error.response;
        wrapped.code = error.code;
        wrapped.cause = error;
        wrapped.upstreamStatus = status;
        wrapped.attempts = attempt + 1;
        wrapped.retryable = true;
        throw wrapped;
      }

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
