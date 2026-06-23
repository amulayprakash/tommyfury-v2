import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { registerProvider } from "@/providers/provider-registry.ts";
import { createFgProvider } from "./fg.provider.ts";

/** Registers FG at startup when enabled; logs (does not crash) on misconfig. */
export function registerFgProvider(): void {
  if (!env.FG_ENABLED) return;
  try {
    registerProvider(createFgProvider());
    logger.info("Future Generali provider registered");
  } catch (err) {
    logger.error({ err }, "FG provider enabled but failed to initialise");
  }
}

export { FgProvider, createFgProvider } from "./fg.provider.ts";
