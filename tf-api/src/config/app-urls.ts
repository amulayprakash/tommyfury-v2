/**
 * Where THIS deployment is reachable from the outside.
 *
 * Vendors call us back (payment ResponseURL) or return the customer's browser to
 * us (CKYC / e-KYC return URLs), so several provider configs need our own public
 * origin. They all build it from the two constants here rather than each holding
 * its own copy.
 *
 * ⚠️ DEPLOYMENT: these are the LOCAL DEV origins. A server deployment must edit
 * both lines — a stale `localhost` here means FG's payment gateway posts its
 * result into the void and HDFC's Pehchaan journey returns the customer to a
 * dead page. This is the only place to change them.
 */
export const API_BASE_URL = "http://localhost:4000";
export const WEB_BASE_URL = "http://localhost:8080";
