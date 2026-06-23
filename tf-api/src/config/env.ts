import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:8080")
    .transform((s) => s.split(",").map((o) => o.trim())),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  ENABLE_DEBUG_PAYLOAD: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // ── ICICI Lombard (credentials env-only, never in DB/code) ──
  ICICI_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  ICICI_BASE_URL: z.string().default("https://ilesbapigee.insurancearticlez.com"),
  ICICI_LOGIN: z.string().optional(),
  ICICI_PASSWORD: z.string().optional(),
  /** Base64 AES key shared by ICICI for password encryption. */
  ICICI_AES_KEY: z.string().optional(),
  /** node:crypto cipher name; exact scheme to be confirmed with ICICI. */
  ICICI_AES_MODE: z.string().default("aes-256-ecb"),

  // ── Future Generali (TCS Motor API) — credentials env-only, never in DB/code ──
  FG_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  /** API gateway base (SOAP motor endpoints live under /MotorNB/1.0.0). */
  FG_BASE_URL: z
    .string()
    .default("https://uat-internal-apigw.generalicentralinsurance.com:8243"),
  /**
   * OAuth2 token endpoint (password grant). The rebranded gateway is on
   * generalicentralinsurance.com; the CKYC v3 doc shows the token host on the
   * same domain (uat-internal-apim.generalicentralinsurance.com:9443). The old
   * futuregenerali.in host is retained only for the legacy renewal product.
   * NOTE: confirm the motor token host with FG before go-live.
   */
  FG_TOKEN_URL: z
    .string()
    .default("https://uat-internal-apim.generalicentralinsurance.com:9443/oauth2/token"),
  /** Base64 "client_id:client_secret" sent as the Authorization: Basic header (motor product). */
  FG_CLIENT_BASIC: z.string().optional(),
  FG_USERNAME: z.string().optional(),
  FG_PASSWORD: z.string().optional(),
  FG_VENDOR_CODE: z.string().default("Webagg"),
  FG_AGENT_CODE: z.string().default("60001464"),
  FG_BRANCH_CODE: z.string().default("10"),

  // ── FG CKYC (GCKYC/3.0.0) — separate WSO2 product (own client subscription) ──
  /** CKYC gateway base (e.g. …/GCKYC/3.0.0). */
  FG_CKYC_BASE_URL: z
    .string()
    .default("https://uat-internal-apigw.generalicentralinsurance.com:8243/GCKYC/3.0.0"),
  /** CKYC OAuth2 token endpoint (may differ from motor; defaults to FG_TOKEN_URL when unset). */
  FG_CKYC_TOKEN_URL: z.string().optional(),
  /** Base64 client for the CKYC product (distinct subscription from motor). */
  FG_CKYC_CLIENT_BASIC: z.string().optional(),
  /** Static gateway subscription key sent as the `Token` header on CKYC calls. */
  FG_CKYC_SUBSCRIPTION_TOKEN: z.string().optional(),

  // ── FG Motor Renewal (motorRenewal/1.0.0) — JSON product on legacy host ──
  FG_RENEWAL_BASE_URL: z
    .string()
    .default("https://uat-internal-apigw.futuregenerali.in:8243/motorRenewal/1.0.0/TCS-Renewal/API/MotorRenewal"),
  FG_RENEWAL_TOKEN_URL: z.string().optional(),
  FG_RENEWAL_CLIENT_BASIC: z.string().optional(),

  // ── FG Web-Aggregator payment gateway (checksum-signed form POST) ──
  /** Hosted payment page the signed form POSTs to (WebAggPayNew.aspx). */
  FG_PAYMENT_URL: z
    .string()
    .default("https://fgnluat.fggeneral.in/Ecom_UAT/WEBAPPLN/UI/Common/WebAggPayNew.aspx"),
  /** PaymentOption code (per PG Parameter details — e.g. "3"). */
  FG_PAYMENT_OPTION: z.string().default("3"),
  /** Absolute URL FG redirects back to after payment (our /payment/callback). */
  FG_PAYMENT_RESPONSE_URL: z.string().optional(),
  /** Reserved: FG's documented CheckSum is unsalted SHA-256 (see payment.ts). */
  FG_PAYMENT_CHECKSUM_SECRET: z.string().optional(),
  /** Absolute web URLs the callback 302-redirects the browser to. */
  FG_PAYMENT_SUCCESS_URL: z.string().optional(),
  FG_PAYMENT_FAILURE_URL: z.string().optional(),

  // ── LiveChek break-in / inspection (third-party REST) ──
  LIVECHEK_BASE_URL: z.string().default("https://newapi.test.livechek.com/api"),
  LIVECHEK_APP_KEY: z.string().optional(),
  LIVECHEK_COMPANY_ID: z.string().optional(),
  LIVECHEK_APP_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${message}`);
}

export const env = parsed.data;
export type Env = typeof env;
