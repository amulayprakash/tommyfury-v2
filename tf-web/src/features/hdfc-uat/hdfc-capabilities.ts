import type { ProviderInfo } from "../vehicle/api/types";

/**
 * Categories and plan types for the HDFC certification harness, read from the
 * provider's own declared capabilities rather than hard-coded.
 *
 * HDFC's kit ships no two-wheeler and no commercial product — it sells Private
 * Car only, which is what HDFC_CAPABILITIES declares on the backend. The list
 * still comes from `provider.capabilities` so that the day HDFC adds a line,
 * the tile appears without a frontend change.
 */

/** Journey order — the order testers see the tiles in. */
const ORDER = ["fourWheeler"] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  fourWheeler: "Private Car",
};

/** Categories HDFC declares, in journey order. */
export function hdfcCategories(provider: ProviderInfo | undefined): string[] {
  if (!provider) return [];
  const declared = new Set<string>(provider.capabilities);
  return ORDER.filter((c) => declared.has(c));
}

/** Plan types HDFC declares for one category ([] when it does not sell it). */
export function hdfcPlanTypes(provider: ProviderInfo | undefined, category: string): string[] {
  const motor = provider?.motorCapabilities as
    | Record<string, { policyTypes?: string[] } | undefined>
    | undefined;
  return motor?.[category]?.policyTypes ?? [];
}
