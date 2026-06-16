import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type {
  CkycRequest,
  KycResult,
  OvdRequest,
  OvdFile,
  OvdResult,
} from "@/contracts/kyc.ts";
import type { PolicyStatusRequest, PolicyStatusResult, CertificateResult } from "@/contracts/policy.ts";

export interface ProviderContext {
  requestId: string;
  accessToken?: string;
}

/** Base contract every provider implements (quote + proposal). */
export interface InsuranceProvider {
  readonly slug: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<VehicleCategory>;
  readonly operations: ReadonlySet<ProviderOperation>;
  /** Per-category plan-type + add-on support (only for supported categories). */
  readonly motorCapabilities: MotorCapabilities;

  getQuote(req: MotorQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult>;
  getFullQuote(req: MotorFullQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult>;
}

// ─── Optional capability interfaces ───────────────────────────────────────────
// A provider opts in by implementing the interface AND listing the operation in
// `operations`. Controllers use the type-guards below to dispatch safely.

export interface QuoteRetrievalProvider extends InsuranceProvider {
  retrieveQuote(
    transactionId: string,
    category: VehicleCategory,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult>;
}

export interface KycCapableProvider extends InsuranceProvider {
  completeCkyc(req: CkycRequest, ctx: ProviderContext): Promise<KycResult>;
  initiateOvd(req: OvdRequest, files: OvdFile[], ctx: ProviderContext): Promise<OvdResult>;
}

export interface PolicyStatusProvider extends InsuranceProvider {
  getPolicyStatus(req: PolicyStatusRequest, ctx: ProviderContext): Promise<PolicyStatusResult>;
}

export interface CertificateProvider extends InsuranceProvider {
  getCertificate(transactionId: string, ctx: ProviderContext): Promise<CertificateResult>;
}

// ─── Type-guards ──────────────────────────────────────────────────────────────

export function supportsQuoteRetrieval(p: InsuranceProvider): p is QuoteRetrievalProvider {
  return p.operations.has("retrieveQuote") && typeof (p as QuoteRetrievalProvider).retrieveQuote === "function";
}

export function supportsKyc(p: InsuranceProvider): p is KycCapableProvider {
  const kp = p as KycCapableProvider;
  return typeof kp.completeCkyc === "function" && typeof kp.initiateOvd === "function";
}

export function supportsPolicyStatus(p: InsuranceProvider): p is PolicyStatusProvider {
  return p.operations.has("policyStatus") && typeof (p as PolicyStatusProvider).getPolicyStatus === "function";
}

export function supportsCertificate(p: InsuranceProvider): p is CertificateProvider {
  return p.operations.has("coi") && typeof (p as CertificateProvider).getCertificate === "function";
}
