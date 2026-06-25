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
import type {
  PolicyStatusRequest,
  PolicyStatusResult,
  CertificateResult,
  PolicyIssuanceRequest,
  PolicyIssuanceResult,
} from "@/contracts/policy.ts";
import type {
  RenewalQuoteRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
import type { InspectionRequest, InspectionResult } from "@/contracts/inspection.ts";
import type { HealthCapabilities } from "@/contracts/health/health-enums.ts";
import type {
  HealthQuoteRequest,
  HealthFullQuoteRequest,
} from "@/contracts/health/health-quote-request.ts";
import type { HealthQuoteResult } from "@/contracts/health/health-quote-result.ts";
import type { HealthIssuanceRequest } from "@/contracts/health/health-policy.ts";

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

export interface IssuanceProvider extends InsuranceProvider {
  /** Binds payment to the prior proposal and issues the real policy. */
  issuePolicy(req: PolicyIssuanceRequest, ctx: ProviderContext): Promise<PolicyIssuanceResult>;
}

export interface RenewalProvider extends InsuranceProvider {
  /** Prices the renewal of an existing policy (keyed by PolicyNo). */
  renewalQuote(req: RenewalQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult>;
  /** Issues the renewal directly with the collected payment receipt. */
  renewalCreatePolicy(
    req: RenewalCreatePolicyRequest,
    ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult>;
}

export interface InspectionProvider extends InsuranceProvider {
  /** Creates a break-in / pre-inspection request. */
  createInspection(req: InspectionRequest, ctx: ProviderContext): Promise<InspectionResult>;
  /** Polls a previously created inspection's status. */
  getInspectionStatus(refId: string, ctx: ProviderContext): Promise<InspectionResult>;
}

export interface PolicyStatusProvider extends InsuranceProvider {
  getPolicyStatus(req: PolicyStatusRequest, ctx: ProviderContext): Promise<PolicyStatusResult>;
}

export interface CertificateProvider extends InsuranceProvider {
  getCertificate(transactionId: string, ctx: ProviderContext): Promise<CertificateResult>;
}

/**
 * Health line-of-business capability. A provider opts in by implementing this AND
 * listing the health ops in `operations`. Entirely separate from the motor
 * quote/proposal on the base interface — controllers dispatch via supportsHealth().
 */
export interface HealthProvider extends InsuranceProvider {
  /** Per-product cover-type matrix the provider supports for health. */
  readonly healthCapabilities: HealthCapabilities;
  getHealthQuote(req: HealthQuoteRequest, ctx: ProviderContext): Promise<HealthQuoteResult>;
  getHealthProposal(req: HealthFullQuoteRequest, ctx: ProviderContext): Promise<HealthQuoteResult>;
  issueHealthPolicy(
    req: HealthIssuanceRequest,
    ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult>;
}

// ─── Type-guards ──────────────────────────────────────────────────────────────

export function supportsQuoteRetrieval(p: InsuranceProvider): p is QuoteRetrievalProvider {
  return p.operations.has("retrieveQuote") && typeof (p as QuoteRetrievalProvider).retrieveQuote === "function";
}

export function supportsKyc(p: InsuranceProvider): p is KycCapableProvider {
  const kp = p as KycCapableProvider;
  return typeof kp.completeCkyc === "function" && typeof kp.initiateOvd === "function";
}

export function supportsIssuance(p: InsuranceProvider): p is IssuanceProvider {
  return p.operations.has("issuance") && typeof (p as IssuanceProvider).issuePolicy === "function";
}

export function supportsRenewal(p: InsuranceProvider): p is RenewalProvider {
  return (
    p.operations.has("renewal") &&
    typeof (p as RenewalProvider).renewalQuote === "function" &&
    typeof (p as RenewalProvider).renewalCreatePolicy === "function"
  );
}

export function supportsInspection(p: InsuranceProvider): p is InspectionProvider {
  return (
    p.operations.has("inspection") &&
    typeof (p as InspectionProvider).createInspection === "function" &&
    typeof (p as InspectionProvider).getInspectionStatus === "function"
  );
}

export function supportsPolicyStatus(p: InsuranceProvider): p is PolicyStatusProvider {
  return p.operations.has("policyStatus") && typeof (p as PolicyStatusProvider).getPolicyStatus === "function";
}

export function supportsCertificate(p: InsuranceProvider): p is CertificateProvider {
  return p.operations.has("coi") && typeof (p as CertificateProvider).getCertificate === "function";
}

export function supportsHealth(p: InsuranceProvider): p is HealthProvider {
  const hp = p as HealthProvider;
  return (
    p.operations.has("healthQuote") &&
    typeof hp.getHealthQuote === "function" &&
    typeof hp.getHealthProposal === "function" &&
    typeof hp.issueHealthPolicy === "function"
  );
}
