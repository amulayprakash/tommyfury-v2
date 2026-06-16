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
  MOCK_PROVIDER_ENABLED: z
    .string()
    .default("true")
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
