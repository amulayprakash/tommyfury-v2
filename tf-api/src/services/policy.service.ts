import { randomUUID } from "node:crypto";
import { getProvider, requireOperation } from "@/providers/provider-registry.ts";
import {
  supportsPolicyStatus,
  supportsCertificate,
  supportsIssuance,
} from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import {
  updatePolicyStatus,
  recordIssuance,
  findQuoteByTransactionId,
} from "@/repositories/quote.repository.ts";
import type {
  PolicyStatusRequest,
  PolicyStatusResult,
  CertificateResult,
  PolicyIssuanceRequest,
  PolicyIssuanceResult,
} from "@/contracts/policy.ts";

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

export async function issuePolicy(
  providerSlug: string,
  req: PolicyIssuanceRequest,
): Promise<PolicyIssuanceResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "issuance");
  if (!supportsIssuance(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares issuance`, "PROVIDER_MISCONFIG");
  }

  // Break-in gate: if an inspection was started for this quote, it must be
  // approved/closed before the policy can be issued (no-op when none exists).
  const existing = await findQuoteByTransactionId(providerSlug, req.quoteNo);
  const status = existing?.policyStatus ?? "";
  if (status.startsWith("INSPECTION") && status !== "INSPECTION_APPROVED" && status !== "INSPECTION_CLOSED") {
    throw new AppError(409, `Inspection not approved (status: ${status})`, "INSPECTION_PENDING");
  }

  const result = await provider.issuePolicy(req, { requestId: randomUUID() });
  await recordIssuance(providerSlug, req, result);
  return result;
}
