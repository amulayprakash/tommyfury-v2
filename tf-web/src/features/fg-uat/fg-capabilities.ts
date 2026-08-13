import type { ProviderInfo } from "../vehicle/api/types";

/**
 * Categories and plan types for the FG certification harness, read from the
 * provider's own declared capabilities rather than hard-coded.
 *
 * FG declares fourWheeler, commercial and newCommercial — there is no two-wheeler
 * capability and no 2W row in its master, so no tile is rendered for it. Third
 * party is absent for private car by design: GCI blocks standalone TP for the
 * web-aggregator channel, so it was removed from FG_MOTOR_CAPABILITIES.
 */

/** Journey order — the order testers see the tiles in. */
const ORDER = ["twoWheeler", "fourWheeler", "commercial", "newCommercial"] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  twoWheeler: "Two Wheeler",
  fourWheeler: "Private Car",
  commercial: "Commercial Vehicle",
  newCommercial: "New Commercial Vehicle",
};

/** Categories FG declares, in journey order. */
export function fgCategories(provider: ProviderInfo | undefined): string[] {
  if (!provider) return [];
  const declared = new Set<string>(provider.capabilities);
  return ORDER.filter((c) => declared.has(c));
}

/** Plan types FG declares for one category ([] when it does not sell it). */
export function fgPlanTypes(provider: ProviderInfo | undefined, category: string): string[] {
  const motor = provider?.motorCapabilities as
    | Record<string, { policyTypes?: string[] } | undefined>
    | undefined;
  return motor?.[category]?.policyTypes ?? [];
}
