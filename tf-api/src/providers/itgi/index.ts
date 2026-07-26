import { env } from "@/config/env.ts";
import { registerProvider } from "../provider-registry.ts";
import { ItgiProvider } from "./itgi.provider.ts";
import { FetchItgiTransport } from "./http.ts";
import { itgiDbCodeResolver } from "./db-code-resolver.ts";

export { ItgiProvider } from "./itgi.provider.ts";

/**
 * ITGI is off by default. Enable with ITGI_ENABLED=true once the vendor issues
 * our partner code and whitelists our IP (docs/itgi-integration-notes.md §8).
 */
export function registerItgiProvider(): void {
  if (!env.ITGI_ENABLED) return;
  registerProvider(
    new ItgiProvider({
      transport: new FetchItgiTransport(),
      resolveCodes: itgiDbCodeResolver,
    }),
  );
}
