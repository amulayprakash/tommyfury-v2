import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";
import type { InsuranceProvider } from "./insurance-provider.ts";
import { AppError, NotFoundError, ProviderCapabilityError } from "@/errors/app-error.ts";

const registry = new Map<string, InsuranceProvider>();

export function registerProvider(provider: InsuranceProvider): void {
  registry.set(provider.slug, provider);
}

export function getProvider(slug: string): InsuranceProvider {
  const provider = registry.get(slug);
  if (!provider) {
    throw new NotFoundError(`Provider "${slug}"`);
  }
  return provider;
}

/** All registered provider instances (used by the compare/aggregation flow). */
export function getAllProviders(): InsuranceProvider[] {
  return Array.from(registry.values());
}

export function requireCapability(provider: InsuranceProvider, category: VehicleCategory): void {
  if (!provider.capabilities.has(category)) {
    throw new ProviderCapabilityError(provider.slug, category);
  }
}

export function requireOperation(provider: InsuranceProvider, operation: ProviderOperation): void {
  if (!provider.operations.has(operation)) {
    throw new AppError(
      422,
      `Provider "${provider.slug}" does not support operation "${operation}"`,
      "PROVIDER_OPERATION_ERROR",
    );
  }
}

export function listProviders(): Array<{
  slug: string;
  displayName: string;
  capabilities: VehicleCategory[];
  operations: ProviderOperation[];
  motorCapabilities: MotorCapabilities;
}> {
  return Array.from(registry.values()).map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    capabilities: Array.from(p.capabilities),
    operations: Array.from(p.operations),
    motorCapabilities: p.motorCapabilities,
  }));
}

/** Test/teardown helper — clears all registered providers. */
export function clearRegistry(): void {
  registry.clear();
}
