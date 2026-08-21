import { z } from "zod";

/**
 * Environment = server wiring + SECRETS ONLY.
 *
 * Everything else a vendor needs — gateway hosts, product/agent/partner codes,
 * token TTLs, payment options, capability toggles — is provider DATA, not
 * deployment configuration, and lives in code beside the adapter that uses it
 * (`src/providers/<slug>/config.ts`, plus `src/config/app-urls.ts` for our own
 * origins). Nothing there is env-overridable: config is authoritative.
 *
 * So the rule for this file: if leaking the value would be a security incident,
 * it belongs here; otherwise it belongs in the provider's config.ts.
 */
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

  // ── ICICI Lombard credentials ──
  // Non-secret ICICI settings: src/providers/icici/config.ts
  ICICI_LOGIN: z.string().optional(),
  ICICI_PASSWORD: z.string().optional(),
  /**
   * Base64 AES key shared by ICICI, used to encrypt the plaintext password. When
   * unset, ICICI_PASSWORD is treated as ALREADY encrypted and sent verbatim.
   */
  ICICI_AES_KEY: z.string().optional(),

  // ── IFFCO-Tokio (ITGI) credentials ──
  // Non-secret ITGI settings (hosts, partner code/branch): src/providers/itgi/config.ts
  /** HTTP Basic credentials for ALL ITGI REST services (CKYC, master data, policy download). */
  ITGI_DOWNLOAD_USER: z.string().default(""),
  ITGI_DOWNLOAD_PASSWORD: z.string().default(""),

  // ── HDFC ERGO credentials ──
  // Non-secret HDFC settings (hosts, source/channel, product code, TTLs):
  // src/providers/hdfc/config.ts
  /** Base64 "user:password" for the HEI token call. */
  HDFC_CREDENTIAL: z.string().optional(),
  /** Pehchaan e-KYC API key (separate service, separate JWT). */
  HDFC_KYC_API_KEY: z.string().optional(),

  // ── Future Generali credentials ──
  // Non-secret FG settings (gateway hosts, vendor/agent/branch codes, payment
  // gateway options, LiveChek host): src/providers/fg/config.ts
  /** Base64 "client_id:client_secret" sent as the Authorization: Basic header (motor product). */
  FG_CLIENT_BASIC: z.string().optional(),
  FG_USERNAME: z.string().optional(),
  FG_PASSWORD: z.string().optional(),
  /**
   * Base64 client for the CKYC product (GCKYC/3.0.0) — a distinct WSO2
   * subscription from motor. Falls back to FG_CLIENT_BASIC when unset.
   */
  FG_CKYC_CLIENT_BASIC: z.string().optional(),
  /**
   * Dedicated CKYC resource-owner login (FG TechSupport: GCCKYC_Dev). The CKYC
   * WSO2 product issues its token to this user, not the shared motor login; both
   * fall back to FG_USERNAME/FG_PASSWORD when unset.
   */
  FG_CKYC_USERNAME: z.string().optional(),
  FG_CKYC_PASSWORD: z.string().optional(),
  /** Static gateway subscription key sent as the `Token` header on CKYC calls. */
  FG_CKYC_SUBSCRIPTION_TOKEN: z.string().optional(),
  /**
   * MUST be the `GCMotorRenewalAPI` subscription's consumer Basic — a DIFFERENT
   * WSO2 product from motor. Left unset, the renewal token is silently minted
   * against the MOTOR subscription and every RenewalModify call 401/403s.
   */
  FG_RENEWAL_CLIENT_BASIC: z.string().optional(),
  /** Base64 client for the health product (distinct subscription from motor). */
  FG_HEALTH_CLIENT_BASIC: z.string().optional(),
  /** Reserved: FG's documented payment CheckSum is unsalted SHA-256 (see fg/payment.ts). */
  FG_PAYMENT_CHECKSUM_SECRET: z.string().optional(),

  // ── LiveChek break-in / inspection credentials ──
  // Non-secret LiveChek setting (base URL): src/providers/fg/config.ts
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
