import { registerProvider } from "../provider-registry.ts";
import { ItgiProvider } from "./itgi.provider.ts";
import { FetchItgiTransport } from "./http.ts";
import { itgiDbCodeResolver } from "./db-code-resolver.ts";
import { ITGI_ENABLED } from "./config.ts";

export { ItgiProvider } from "./itgi.provider.ts";

/**
 * Gated by ITGI_ENABLED in ./config.ts — flip it there once the vendor
 * whitelists our IP (docs/itgi-integration-notes.md §8).
 */
export function registerItgiProvider(): void {
  if (!ITGI_ENABLED) return;
  registerProvider(
    new ItgiProvider({
      transport: new FetchItgiTransport(),
      resolveCodes: itgiDbCodeResolver,
    }),
  );
}
