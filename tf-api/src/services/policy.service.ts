import { randomUUID } from "node:crypto";
import { getProvider, requireOperation } from "@/providers/provider-registry.ts";
import { supportsPolicyStatus, supportsCertificate } from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import { updatePolicyStatus } from "@/repositories/quote.repository.ts";
import type { PolicyStatusRequest, PolicyStatusResult, CertificateResult } from "@/contracts/policy.ts";

export async function getPolicyStatus(
  providerSlug: string,
  req: PolicyStatusRequest,
): Promise<PolicyStatusResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "policyStatus");
  if (!supportsPolicyStatus(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares policyStatus`, "PROVIDER_MISCONFIG");
  }
  const result = await provider.getPolicyStatus(req, { requestId: randomUUID() });
  await updatePolicyStatus(providerSlug, req.transactionId, result.status, result.policyNumber);
  return result;
}

export async function getCertificate(
  providerSlug: string,
  transactionId: string,
): Promise<CertificateResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "coi");
  if (!supportsCertificate(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares coi`, "PROVIDER_MISCONFIG");
  }
  return provider.getCertificate(transactionId, { requestId: randomUUID() });
}
