/**
 * Where THIS deployment is reachable from the outside.
 *
 * Vendors call us back (payment ResponseURL) or return the customer's browser to
 * us (CKYC / e-KYC return URLs), so several provider configs need our own public
 * origin. They all build it from the two constants here rather than each holding
 * its own copy.
 *
 * ⚠️ DEPLOYMENT: the origins are chosen by NODE_ENV, and both sets are committed
 * — nothing here is env-overridable (see the rule at the top of config/env.ts).
 * `PRODUCTION_URLS` must name the origin this deployment is actually reachable
 * at. A stale `localhost` there means FG's payment gateway posts its result into
 * the void and HDFC's Pehchaan journey returns the customer to a dead page.
 * This file is the only place to change them.
 */
import { env } from "@/config/env.ts";

export interface AppUrls {
  /** Origin vendors POST server-to-server callbacks to (tf-api). */
  readonly api: string;
  /** Origin a vendor returns the customer's BROWSER to (tf-web). */
  readonly web: string;
}

/** Local dev servers. `test` uses these too, so the suite depends on no deployment. */
const DEVELOPMENT_URLS: AppUrls = {
  api: "http://localhost:4000",
  web: "http://localhost:8080",
};

/**
 * Shree (103.127.167.212). Apache serves tf-web at the origin root and
 * reverse-proxies /api/v1 to 127.0.0.1:4000, so both share a single origin.
 * Swapping in a real domain + TLS is a change to these two lines.
 */
const PRODUCTION_URLS: AppUrls = {
  api: "http://103.127.167.212",
  web: "http://103.127.167.212",
};

/** The whole rule, as a pure function so it can be tested for every NODE_ENV. */
export function resolveAppUrls(nodeEnv: string): AppUrls {
  return nodeEnv === "production" ? PRODUCTION_URLS : DEVELOPMENT_URLS;
}

const urls = resolveAppUrls(env.NODE_ENV);

export const API_BASE_URL = urls.api;
export const WEB_BASE_URL = urls.web;
