import express from 'express';
import cors from 'cors';

import config from '../config/env.js';
import db from '../db/index.js';
import auth_routes from './auth.routes.js';
import quote_routes from './quote.routes.js';
import proposal_routes from './proposal.routes.js';
import payment_routes from './payment.routes.js';
import case_routes from './case.routes.js';
import journey_routes from './journey.routes.js';
import { resolveJourney } from '../middleware/journeyContext.js';
import { logRequest } from '../middleware/requestLogger.js';
import { errorHandler, notFound } from '../middleware/errorHandler.js';

// Every NivaBupa route lives under this one prefix, which is what makes the
// module safe to mount inside tf-api: all of its middleware is registered
// against this path, so nothing in here ever runs for /api/v1/*.
export const NIVABUPA_PATH_PREFIX = '/nivabupa';

// verify: captures the exact raw bytes on req.rawBody before the body is
// decoded — kept from the original backend for diagnosing the NivaBupa
// payment/return callback (does not change parsing behavior for any route).
const captureRawBody = (req, res, buf) => { req.rawBody = buf; };

function corsOptions() {
  return config.corsOrigins === '*'
    ? {}
    : { origin: config.corsOrigins.split(',').map((o) => o.trim()).filter(Boolean) };
}

// The NivaBupa router, self-contained: its own CORS policy, its own body
// parsers and its own access log, all scoped to NIVABUPA_PATH_PREFIX.
//
// It carries its own middleware rather than reusing tf-api's app-level stack for
// three reasons that would each change NivaBupa behaviour:
//   * CORS — tf-api allows only GET/POST/OPTIONS; the journey endpoints use
//     PATCH and PUT, so a browser preflight would fail against them.
//   * rate limiting — tf-api rate-limits every route. NivaBupa's gateway POSTs
//     /nivabupa/payment/return server-to-server; a 429 there means the buyer
//     paid and never got a confirmation. This router answers before the limiter
//     is reached (see app.ts mount order).
//   * body parsing — these two parsers run first for NivaBupa paths, so
//     req.rawBody is captured and the original 100kb limit is kept. tf-api's
//     own express.json() then no-ops for an already-parsed body.
export function createNivabupaRouter() {
  const router = express.Router();

  router.use(
    NIVABUPA_PATH_PREFIX,
    cors(corsOptions()),
    express.json({ verify: captureRawBody }),
    // NivaBupa's payment gateway posts the return callback as a form body, not JSON.
    express.urlencoded({ extended: true, verify: captureRawBody }),
    logRequest,
  );

  // Journey routes are mounted ABOVE resolveJourney, and the order is load-bearing.
  //
  // resolveJourney deletes journeyId / resumeToken from req.body so the
  // pass-through controllers below cannot forward them into a NivaBupa payload
  // (see middleware/journeyContext.js). The journey endpoints take those same two
  // values as legitimate body fields — POST /nivabupa/journey/resume is nothing
  // but a resumeToken — so running the middleware first would strip the very
  // field the handler needs and answer 400 on every resume.
  router.use(journey_routes);   // POST/GET/PATCH/PUT /nivabupa/journey/*

  // Everything below is a NivaBupa pass-through: resolve the optional journey and
  // scrub the identity fields out of the forwarded body. Registered here rather
  // than in app.ts so it runs for both the '/' and '/health' prefixes without
  // being wired up twice.
  router.use(NIVABUPA_PATH_PREFIX, resolveJourney);

  router.use(auth_routes);      // GET  /nivabupa/token/test
  router.use(quote_routes);     // POST /nivabupa/premium
  router.use(proposal_routes);  // POST /nivabupa/uw-decision, /nivabupa/datapush
  router.use(payment_routes);   // POST /nivabupa/payment/initiate, /nivabupa/payment/return
  router.use(case_routes);      // POST /nivabupa/proposal-status, /nivabupa/policy-download

  // Path-scoped so the NivaBupa 404/500 envelopes apply to NivaBupa routes only
  // and tf-api's own handlers keep serving everything else untouched.
  router.use(NIVABUPA_PATH_PREFIX, notFound);
  router.use(NIVABUPA_PATH_PREFIX, errorHandler);

  return router;
}

// GET /healthz and GET /readyz — the NivaBupa service's own probes, kept at the
// paths its orchestrator already polls. tf-api's equivalents live under
// /api/v1/healthz and /api/v1/readyz and are untouched; these two report on the
// NivaBupa MySQL connection, which Prisma knows nothing about.
export function createNivabupaProbeRouter() {
  const router = express.Router();

  router.use(['/healthz', '/readyz'], cors(corsOptions()), logRequest);

  // Liveness only — deliberately does NOT touch MySQL. An orchestrator must not
  // restart a healthy process because the database is briefly unreachable: the
  // NivaBupa pass-through endpoints keep serving without it (persistence
  // degrades, the integration does not stop — see services/journey.service.js).
  router.get('/healthz', (req, res) => {
    res.status(200).json({
      status: 'OK',
      service: 'nivabupa-backend',
      env: config.env,
      timestamp: new Date().toISOString()
    });
  });

  // Readiness — this one does check MySQL, and reports 503 when journey
  // persistence is unavailable. Use this for "can this instance serve resume
  // requests", and /healthz for "is the process alive".
  router.get('/readyz', async (req, res) => {
    const result = await db.verifyConnection();
    return res.status(result.ok ? 200 : 503).json({
      status: result.ok ? 'READY' : 'DEGRADED',
      service: 'nivabupa-backend',
      env: config.env,
      database: result.ok
        ? { connected: true, schema: result.db, version: result.version }
        : { connected: false, error: result.error },
      journeyPersistence: result.ok ? 'ENABLED' : 'UNAVAILABLE — NivaBupa pass-through still served',
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
