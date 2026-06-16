import { z } from "zod";

const envSchema = z.object({
  VITE_LEGACY_API_URL: z.url(),
  VITE_VENDOR_API_URL: z.url(),
  VITE_IDLE_TIMEOUT_MIN: z.coerce.number().int().positive().default(30),
  /** Third-party RC (vehicle registration) lookup, called directly from the browser. */
  VITE_RC_API_URL: z.url().default("https://regtechapi.in/api/rc_validationworking"),
  /** AccessToken header for the regtech RC lookup. */
  VITE_RC_API_TOKEN: z.string().default("11c1aa0a8436518ee16fcbb2a78265550b"),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  // Fail fast at boot: a misconfigured build must never fall back to guessed URLs.
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
