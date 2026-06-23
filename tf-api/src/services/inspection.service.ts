import { randomUUID } from "node:crypto";
import { getProvider, requireOperation } from "@/providers/provider-registry.ts";
import { supportsInspection } from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import { updatePolicyStatus } from "@/repositories/quote.repository.ts";
import type { InspectionRequest, InspectionResult } from "@/contracts/inspection.ts";

function inspectionProvider(providerSlug: string) {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "inspection");
  if (!supportsInspection(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares inspection`, "PROVIDER_MISCONFIG");
  }
  return provider;
}

export async function createInspection(
  providerSlug: string,
  req: InspectionRequest,
): Promise<InspectionResult> {
  const result = await inspectionProvider(providerSlug).createInspection(req, {
    requestId: randomUUID(),
  });
  // refId is the quoteNo, so the inspection status lands on the quote row.
  await updatePolicyStatus(providerSlug, req.refId, result.status);
  return result;
}

export async function getInspectionStatus(
  providerSlug: string,
  refId: string,
): Promise<InspectionResult> {
  const result = await inspectionProvider(providerSlug).getInspectionStatus(refId, {
    requestId: randomUUID(),
  });
  await updatePolicyStatus(providerSlug, refId, result.status);
  return result;
}
