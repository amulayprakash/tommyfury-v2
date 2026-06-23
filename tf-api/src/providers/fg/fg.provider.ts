import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { PolicyIssuanceRequest, PolicyIssuanceResult } from "@/contracts/policy.ts";
import type { CkycRequest, KycResult, OvdRequest, OvdFile, OvdResult } from "@/contracts/kyc.ts";
import type {
  RenewalQuoteRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
import type { InspectionRequest, InspectionResult } from "@/contracts/inspection.ts";
import type {
  InsuranceProvider,
  IssuanceProvider,
  KycCapableProvider,
  RenewalProvider,
  InspectionProvider,
  ProviderContext,
} from "@/providers/insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";
import { tokenManager } from "@/providers/token-manager.ts";

import {
  FG_SLUG,
  FG_DISPLAY_NAME,
  FG_CAPABILITIES,
  FG_OPERATIONS,
  FG_MOTOR_CAPABILITIES,
  loadFgConfig,
  type FgConfig,
} from "./config.ts";
import { fgTokenFetcher, fgProductTokenFetcher } from "./auth.ts";
import { fgVerifyCkyc, fgGetCkycStatus } from "./ckyc.ts";
import { fgRenewalQuote, fgRenewalCreatePolicy } from "./renewal.ts";
import { createInspection, getInspectionStatus } from "./inspection.ts";
import { FetchTransport, assertFgSuccess, type FgTransport } from "./http.ts";
import {
  buildGetQuotePayload,
  buildCreateProposalPayload,
  buildIssueProposalPayload,
  buildSoapEnvelope,
  SOAP_ACTIONS,
  type FgResolvedCodes,
  type FgPayloadMeta,
} from "./mapper.ts";
import { normalizeQuote, normalizeProposal, normalizeIssuance, extractRoot } from "./normalizer.ts";
import { dbCodeResolver } from "./db-code-resolver.ts";

/** Resolves canonical IDs → FG master codes (make label / model / RTO / zone). */
export type FgCodeResolver = (req: MotorQuoteRequest) => Promise<FgResolvedCodes>;

/** Dev/fixtures resolver: canonical fields are used as the FG codes directly. */
export const passthroughCodeResolver: FgCodeResolver = async (req) => ({
  make: req.makeName || req.makeId,
  modelCode: req.modelId,
  rtoCode: req.rtoCode,
  zone: "A",
  engineCC: req.engineCC,
  gvw: req.grossVehicleWeight,
  seatingCapacity: req.seatingCapacity,
  carryingCapacity: req.carryingCapacity,
});

export interface FgProviderDeps {
  config: FgConfig;
  transport?: FgTransport;
  codeResolver?: FgCodeResolver;
  /** Override token acquisition (tests bypass the live OAuth2 call). */
  tokenProvider?: () => Promise<string>;
  /** Override the CKYC-product token (separate WSO2 subscription). */
  ckycTokenProvider?: () => Promise<string>;
  /** Override the renewal-product token. */
  renewalTokenProvider?: () => Promise<string>;
}

export class FgProvider
  implements
    InsuranceProvider,
    IssuanceProvider,
    KycCapableProvider,
    RenewalProvider,
    InspectionProvider
{
  readonly slug = FG_SLUG;
  readonly displayName = FG_DISPLAY_NAME;
  readonly capabilities: ReadonlySet<VehicleCategory> = FG_CAPABILITIES;
  readonly operations: ReadonlySet<ProviderOperation> = FG_OPERATIONS;
  readonly motorCapabilities: MotorCapabilities = FG_MOTOR_CAPABILITIES;

  private readonly config: FgConfig;
  private readonly transport: FgTransport;
  private readonly codeResolver: FgCodeResolver;
  private readonly tokenProvider: () => Promise<string>;
  private readonly ckycTokenProvider: () => Promise<string>;
  private readonly renewalTokenProvider: () => Promise<string>;

  constructor(deps: FgProviderDeps) {
    this.config = deps.config;
    this.transport = deps.transport ?? new FetchTransport();
    this.codeResolver = deps.codeResolver ?? passthroughCodeResolver;
    this.tokenProvider =
      deps.tokenProvider ??
      (() =>
        tokenManager.getToken(
          `${FG_SLUG}:${this.config.credentialSetId}`,
          fgTokenFetcher(this.config),
        ));
    this.ckycTokenProvider =
      deps.ckycTokenProvider ??
      (() =>
        tokenManager.getToken(
          `${FG_SLUG}-ckyc:${this.config.credentialSetId}`,
          fgProductTokenFetcher(this.config, this.config.ckyc),
        ));
    this.renewalTokenProvider =
      deps.renewalTokenProvider ??
      (() =>
        tokenManager.getToken(
          `${FG_SLUG}-renewal:${this.config.credentialSetId}`,
          fgProductTokenFetcher(this.config, this.config.renewal),
        ));
  }

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  private get meta(): FgPayloadMeta {
    return {
      vendorCode: this.config.vendorCode,
      agentCode: this.config.agentCode,
      branchCode: this.config.branchCode,
    };
  }

  async getQuote(req: MotorQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    const token = await this.tokenProvider();
    const codes = await this.codeResolver(req);
    const { url, payload } = buildGetQuotePayload(req, codes, this.meta, ctx.requestId);

    const body = await this.transport.request({
      method: "POST",
      url: this.url(url),
      token,
      xmlBody: buildSoapEnvelope("getQuote", payload),
      soapAction: SOAP_ACTIONS.getQuote,
    });
    assertFgSuccess(extractRoot(body), "get-quote");

    return normalizeQuote(body, {
      requestId: ctx.requestId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
    });
  }

  async getFullQuote(
    req: MotorFullQuoteRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    // FG has no "retrieve quote by id" — CreateProposal (CRT) is built directly
    // against the prior QuotationNumber (req.quoteId → strpolicyquoteNumber) and
    // returns the (bound) premium in the same response shape as a quote.
    const token = await this.tokenProvider();
    const codes = await this.codeResolver(req);
    const { url, payload } = buildCreateProposalPayload(req, codes, this.meta, ctx.requestId);

    const body = await this.transport.request({
      method: "POST",
      url: this.url(url),
      token,
      xmlBody: buildSoapEnvelope("createProposal", payload),
      soapAction: SOAP_ACTIONS.createProposal,
    });
    assertFgSuccess(extractRoot(body), "create-proposal");

    return normalizeProposal(body, {
      requestId: ctx.requestId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
    });
  }

  async issuePolicy(
    req: PolicyIssuanceRequest,
    ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    // Final step: bind the collected payment (Receipt) to the prior proposal
    // (ClientID + QuotationNo) and issue the real policy. Same SOAP transport.
    const token = await this.tokenProvider();
    const { url, payload } = buildIssueProposalPayload(req, this.meta, ctx.requestId);

    const body = await this.transport.request({
      method: "POST",
      url: this.url(url),
      token,
      xmlBody: buildSoapEnvelope("issueProposal", payload),
      soapAction: SOAP_ACTIONS.issueProposal,
    });
    assertFgSuccess(extractRoot(body), "policy-issuance");

    return normalizeIssuance(body, { quoteNo: req.quoteNo });
  }

  async completeCkyc(req: CkycRequest, _ctx: ProviderContext): Promise<KycResult> {
    const token = await this.ckycTokenProvider();
    const result = await fgVerifyCkyc(this.config, req, token);
    // On an auto-match, fetch the confirmed CKYC number for the proposal.
    if (result.isKycSuccess && result.proposalId) {
      try {
        const status = await fgGetCkycStatus(this.config, result.proposalId, token);
        if (status.ckycNumber) {
          result.ckycNumber = status.ckycNumber;
          result.kycId = status.ckycNumber;
        }
      } catch {
        // Best-effort: the proposalId still links the verified KYC.
      }
    }
    return result;
  }

  initiateOvd(_req: OvdRequest, _files: OvdFile[], _ctx: ProviderContext): Promise<OvdResult> {
    // FG has no document-upload API; manual KYC is a hosted redirect surfaced by
    // completeCkyc (KycResult.redirectUrl). "ovd" is not in FG_OPERATIONS.
    throw new AppError(501, "FG does not support OVD document upload", "NOT_IMPLEMENTED");
  }

  async renewalQuote(req: RenewalQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    const token = await this.renewalTokenProvider();
    return fgRenewalQuote(this.config, req, token, {
      requestId: ctx.requestId,
      vehicleCategory: "fourWheeler",
      policyType: "comprehensive",
    });
  }

  async renewalCreatePolicy(
    req: RenewalCreatePolicyRequest,
    _ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    const token = await this.renewalTokenProvider();
    return fgRenewalCreatePolicy(this.config, req, token);
  }

  createInspection(req: InspectionRequest, _ctx: ProviderContext): Promise<InspectionResult> {
    return createInspection(this.config, req);
  }

  getInspectionStatus(refId: string, _ctx: ProviderContext): Promise<InspectionResult> {
    return getInspectionStatus(this.config, refId);
  }
}

/** Factory used at startup — loads + validates env config, DB-backed resolver. */
export function createFgProvider(): FgProvider {
  return new FgProvider({ config: loadFgConfig(), codeResolver: dbCodeResolver });
}
