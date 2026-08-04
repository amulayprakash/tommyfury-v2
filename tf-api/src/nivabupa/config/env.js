// Hardcoded fallbacks, not just env vars — production's .env is a separate,
// gitignored file the deploy pipeline never edits, so a brand-new env var
// silently never reaches it there. Falling back to the known-good UAT
// values means a plain git push fixes this instead of requiring someone to
// SSH in and edit .env by hand. process.env still wins if it's ever set.
//
// The one deliberate exception is caseApi.userId / caseApi.clientId — see
// services/caseApiAuth.service.js: NivaBupa ships no sample values for those,
// so they fail loudly instead of sending "undefined" credentials.
//
// ── Note on env loading (tf-api integration) ────────────────────────────────
// The standalone service called dotenv.config() here. Inside tf-api the process
// receives its environment from Node's own --env-file=.env (see the `dev` and
// `nivabupa:*` npm scripts), so there is no dotenv call: adding one would also
// start loading .env into the *existing* tf-api config in `npm start`, which is
// deliberately env-only in production. Every NivaBupa value below keeps its
// hardcoded fallback, so this module behaves identically either way.

// NivaBupa's journey tables live in their own MySQL database (`policy_db` —
// the host Laravel application's schema, which owns the `users` table journeys
// attach to), NOT in tf-api's Prisma database. The two connections are separate
// on purpose and must not be merged.
//
// DB_* are the variable names the standalone service used and they stay
// authoritative so an existing .env keeps working unchanged. NIVABUPA_DB_* is
// accepted as a higher-precedence alias: `DB_HOST` is generic enough to collide
// with something else in a shared process, and the prefixed form makes it
// unambiguous which database is meant when tf-api's own DATABASE_URL sits in
// the same file.
const dbEnv = (suffix, fallback) => {
  const prefixed = process.env[`NIVABUPA_DB_${suffix}`];
  if (prefixed !== undefined && prefixed !== "") return prefixed;
  const plain = process.env[`DB_${suffix}`];
  if (plain !== undefined && plain !== "") return plain;
  return fallback;
};

// Password is read separately: '' is a legitimate value (the supplied local
// MySQL root account has no password), so an empty string must not fall through
// to the next source the way it does for a host or a database name.
const dbPassword = () => {
  if (process.env.NIVABUPA_DB_PASSWORD !== undefined) return process.env.NIVABUPA_DB_PASSWORD;
  if (process.env.DB_PASSWORD !== undefined) return process.env.DB_PASSWORD;
  return "";
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,

  // Where handlePaymentReturn 302s the buyer's browser after decrypting the
  // gateway callback — the ONDC frontend's origin, which still hosts the
  // /nivabupa-return page.
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Comma-separated list, or '*' for any origin (the previous behaviour of
  // the shared ONDC backend, which used a bare `cors()`). Deliberately its own
  // variable rather than tf-api's ALLOWED_ORIGINS: the NivaBupa journey
  // endpoints use PATCH/PUT, which tf-api's CORS layer does not allow, so the
  // two policies are not interchangeable.
  corsOrigins: process.env.NIVABUPA_CORS_ORIGINS || process.env.CORS_ORIGINS || '*',

  // MySQL — backs the journey break / resume feature. Same fallback policy as
  // the NivaBupa credentials above: local dev values so a fresh checkout runs
  // without a .env, process.env wins in every deployed environment.
  db: {
    connection: dbEnv('CONNECTION', 'mysql'),
    host: dbEnv('HOST', '127.0.0.1'),
    port: Number(dbEnv('PORT', 3306)),
    database: dbEnv('DATABASE', 'policy_db'),
    user: dbEnv('USERNAME', 'root'),
    // Intentionally allows '' — the supplied local MySQL root account has no
    // password, and `|| ''` would turn a deliberately-set password of '0' into
    // '' anyway, so read it as-is and only default when truly undefined.
    password: dbPassword(),
    connectionLimit: Number(dbEnv('POOL_SIZE', 10)),
    // A journey save must never hang a request behind a saturated pool; fail
    // fast and let the controller answer the caller (see db/index.js — a save
    // failure is logged, not thrown at the buyer).
    connectTimeout: Number(dbEnv('CONNECT_TIMEOUT_MS', 10000)),
  },

  journey: {
    // How long a broken journey stays resumable. 7 days: long enough to cover
    // a buyer who abandons at payment and comes back the following weekend,
    // short enough that stale quotes (whose premium is only valid for the
    // premiumCalculationDate sent upstream) are not silently resumed months
    // later at a price NivaBupa would no longer honour.
    ttlDays: Number(process.env.JOURNEY_TTL_DAYS) || 7,
    // Journeys idle longer than this are swept to ABANDONED by the sweeper so
    // funnel reporting distinguishes "still deciding" from "gone".
    abandonAfterHours: Number(process.env.JOURNEY_ABANDON_AFTER_HOURS) || 48,
    sweepIntervalMinutes: Number(process.env.JOURNEY_SWEEP_INTERVAL_MINUTES) || 60,
  },

  nivabupa: {
    // Dumps the full upstream request/response for every /api/generic/* call to
    // stdout. Off unless explicitly set: these bodies carry PII (PAN, DOB,
    // medical answers) and pm2 keeps stdout on disk indefinitely, so this is a
    // deliberate, temporary diagnostic rather than a default.
    //
    // Failures are logged in full regardless of this flag — see
    // services/genericApi.service.js. api_transactions already persists both
    // outcomes; this exists so a live call can be watched in `pm2 logs` without
    // a database round-trip.
    debug: process.env.NIVABUPA_DEBUG === '1',

    // OAuth client_credentials pair for the /api/generic/* family
    // (token / premium / uwDecision / datapush).
    clientId: process.env.NIVABUPA_CLIENT_ID || 'cdceaca20073415586ed9e28c7337ae1',
    clientSecret: process.env.NIVABUPA_CLIENT_SECRET || 'idcscs-91476a29-94d2-494f-bbb4-990c28984050',
    identifierCode: process.env.NIVABUPA_IDENTIFIER_CODE || 'BR08860001',
    tokenUrl: process.env.NIVABUPA_TOKEN_URL || 'https://digitaluat.nivabupa.com/api/generic/token',
    scope: process.env.NIVABUPA_SCOPE || 'https://uat.nbhi.ohi.ocs.oraclecloud.com/uat/urn::ohi-components-apis',

    premiumUrl: process.env.NIVABUPA_PREMIUM_URL || 'https://digitaluat.nivabupa.com/api/generic/premium',
    uwDecisionUrl: process.env.NIVABUPA_UW_DECISION_URL || 'https://digitaluat.nivabupa.com/api/generic/uwDecision',
    dataPushUrl: process.env.NIVABUPA_DATAPUSH_URL || 'https://digitaluat.nivabupa.com/api/generic/datapush',

    // Case API (Proposal Status / Policy Download) — different host prefix
    // (/caseapi/), different credential pair, token goes in an `access_token`
    // header rather than `Authorization`.
    caseApi: {
      tokenUrl: process.env.NIVABUPA_CASEAPI_TOKEN_URL || 'https://digitaluat.nivabupa.com/caseapi/api/auth/v1/getauthtoken',
      userId: process.env.NIVABUPA_CASEAPI_USER_ID,
      clientId: process.env.NIVABUPA_CASEAPI_CLIENT_ID,
      proposalStatusUrl: process.env.NIVABUPA_PROPOSAL_STATUS_URL || 'https://digitaluat.nivabupa.com/caseapi/api/common/getpreissuancestatus',
      policyDownloadUrl: process.env.NIVABUPA_POLICY_DOWNLOAD_URL || 'https://digitaluat.nivabupa.com/caseapi/api/document/getalldocument',
    },

    payment: {
      gatewayUrl: process.env.NIVABUPA_PAYMENT_GATEWAY_URL || 'https://paymbhid.nivabupa.com/Pages/getPaymentValues.aspx',
      // Unlike the URLs above (NivaBupa-hosted), this one is ours — where their
      // payment gateway calls back to once the buyer completes payment. It has to
      // be a publicly reachable address (NivaBupa's servers hit it directly, not
      // the buyer's browser), so it must point at *this* deployed backend even
      // when initiatePayment itself is being tested locally — localhost is never
      // reachable from NivaBupa's side. It also has to be pre-registered with
      // NivaBupa, so changing the host means telling them about it.
      returnUrl: process.env.NIVABUPA_PAYMENT_RETURN_URL || 'https://ondc.healthinsurance.tommyandfurry.com/health/nivabupa/payment/return',
      soapUrl: process.env.NIVABUPA_SOAP_URL || 'https://uat-transactions.nivabupa.com/websiteService/Service1.svc',
      encryptionKey: process.env.NIVABUPA_PAYMENT_ENCRYPTION_KEY || 'nivabupauat@(!!*()@',
      // "!max#bupa@" confirmed working 2026-07-28 by direct test — cleanly
      // decrypted a real returnMessage (sourcingsystem=TOMMYANDFURRY, the old
      // value). NivaBupa support's "!max#bupaNovacred@" (for sourcingsystem=
      // Novacred) has NOT decrypted anything successfully in testing.
      decryptionKey: process.env.NIVABUPA_PAYMENT_DECRYPTION_KEY || '!max#bupa@',
    },
  },

  timeouts: {
    token: 15000,
    api: 20000,
    soap: 20000,
  },
};

export default config;
