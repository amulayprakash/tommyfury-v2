import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { registerProvider } from "@/providers/provider-registry.ts";
import { createHdfcProvider } from "./hdfc.provider.ts";

/** Registers HDFC at startup when enabled; logs (does not crash) on misconfig. */
export function registerHdfcProvider(): void {
  if (!env.HDFC_ENABLED) return;
  try {
    registerProvider(createHdfcProvider());
    logger.info("HDFC ERGO provider registered");
  } catch (err) {
    logger.error({ err }, "HDFC provider enabled but failed to initialise");
  }
}

export { HdfcProvider, createHdfcProvider } from "./hdfc.provider.ts";
