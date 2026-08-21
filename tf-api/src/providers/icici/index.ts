import { logger } from "@/lib/logger.ts";
import { registerProvider } from "@/providers/provider-registry.ts";
import { createIciciProvider } from "./icici.provider.ts";
import { ICICI_ENABLED } from "./config.ts";

/** Registers ICICI at startup when enabled; logs (does not crash) on misconfig. */
export function registerIciciProvider(): void {
  if (!ICICI_ENABLED) return;
  try {
    registerProvider(createIciciProvider());
    logger.info("ICICI Lombard provider registered");
  } catch (err) {
    logger.error({ err }, "ICICI provider enabled but failed to initialise");
  }
}

export { IciciProvider, createIciciProvider } from "./icici.provider.ts";
