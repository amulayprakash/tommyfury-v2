import { randomUUID } from "node:crypto";
import { getProvider, requireOperation } from "@/providers/provider-registry.ts";
import { supportsKyc } from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import { attachKyc } from "@/repositories/quote.repository.ts";
import type { CkycRequest, KycResult, OvdRequest, OvdFile, OvdResult } from "@/contracts/kyc.ts";

export async function completeCkyc(providerSlug: string, req: CkycRequest): Promise<KycResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "ckyc");
  if (!supportsKyc(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares ckyc`, "PROVIDER_MISCONFIG");
  }
  const result = await provider.completeCkyc(req, { requestId: randomUUID() });
  await attachKyc(providerSlug, req.transactionId, result.kycId);
  return result;
}

export async function initiateOvd(
  providerSlug: string,
  req: OvdRequest,
  files: OvdFile[],
): Promise<OvdResult> {
  const provider = getProvider(providerSlug);
  requireOperation(provider, "ovd");
  if (!supportsKyc(provider)) {
    throw new AppError(500, `Provider "${providerSlug}" mis-declares ovd`, "PROVIDER_MISCONFIG");
  }
  const result = await provider.initiateOvd(req, files, { requestId: randomUUID() });
  await attachKyc(providerSlug, req.transactionId, result.kycId);
  return result;
}
