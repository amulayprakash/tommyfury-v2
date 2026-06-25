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
  HealthQuoteRequest,
  HealthFullQuoteRequest,
} from "@/contracts/health/health-quote-request.ts";
import type { HealthIssuanceRequest } from "@/contracts/health/health-policy.ts";
import type { HealthQuoteResult } from "@/contracts/health/health-quote-result.ts";
import type { HealthCapabilities } from "@/contracts/health/health-enums.ts";
import type {
  InsuranceProvider,
  IssuanceProvider,
  KycCapableProvider,
  RenewalProvider,
  InspectionProvider,
  HealthProvider,
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
import { FG_HEALTH_CAPABILITIES, getFgHealthProduct } from "./health/config.ts";
import {
  buildHealthQuotePayload,
  buildHealthProposalPayload,
  buildHealthIssuancePayload,
  buildHealthSoapEnvelope,
  type FgHealthBuildResult,
  type FgHealthPayloadMeta,
} from "./health/mapper.ts";
import {
  normalizeHealthQuote,
  normalizeHealthProposal,
  normalizeHealthIssuance,
  extractHealthRoot,
  assertHealthQuotePriced,
} from "./health/normalizer.ts";
import {
  dbHealthCodeResolver,
  passthroughHealthResolver,
  type FgHealthCodeResolver,
} from "./health/db-code-resolver.ts";

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
  /** Override the health-product token. */
  healthTokenProvider?: () => Promise<string>;
  /** Override health master-code resolution (tests use the pass-through resolver). */
  healthCodeResolver?: FgHealthCodeResolver;
}

export class FgProvider
  implements
    InsuranceProvider,
    IssuanceProvider,
    KycCapableProvider,
    RenewalProvider,
    InspectionProvider,
    HealthProvider
{
  readonly slug = FG_SLUG;
  readonly displayName = FG_DISPLAY_NAME;
  readonly capabilities: ReadonlySet<VehicleCategory> = FG_CAPABILITIES;
  readonly operations: ReadonlySet<ProviderOperation> = FG_OPERATIONS;
  readonly motorCapabilities: MotorCapabilities = FG_MOTOR_CAPABILITIES;
  readonly healthCapabilities: HealthCapabilities = FG_HEALTH_CAPABILITIES;

  private readonly config: FgConfig;
  private readonly transport: FgTransport;
  private readonly codeResolver: FgCodeResolver;
  private readonly tokenProvider: () => Promise<string>;
  private readonly ckycTokenProvider: () => Promise<string>;
  private readonly renewalTokenProvider: () => Promise<string>;
  private readonly healthTokenProvider: () => Promise<string>;
  private readonly healthCodeResolver: FgHealthCodeResolver;

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
    this.healthTokenProvider =
      deps.healthTokenProvider ??
      (() =>
        tokenManager.getToken(
          `${FG_SLUG}-health:${this.config.credentialSetId}`,
          fgProductTokenFetcher(this.config, this.config.health),
        ));
    this.healthCodeResolver = deps.healthCodeResolver ?? passthroughHealthResolver;
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

  // ─── Health line of business (TCS BO Service) ───────────────────────────────

  private get healthMeta(): FgHealthPayloadMeta {
    return {
      vendorCode: this.config.vendorCode,
      agentCode: this.config.health.agentCode,
      branchCode: this.config.health.branchCode,
    };
  }

  /** Single SOAP round-trip for any health op; asserts business success. */
  private async healthCall(build: FgHealthBuildResult, context: string): Promise<unknown> {
    const token = await this.healthTokenProvider();
    const body = await this.transport.request({
      method: "POST",
      url: this.config.health.baseUrl,
      token,
      xmlBody: buildHealthSoapEnvelope(build.method, build.soapProduct, build.payload),
      soapAction: build.soapAction,
    });
    assertFgSuccess(extractHealthRoot(body), context);
    return body;
  }

  async getHealthQuote(req: HealthQuoteRequest, ctx: ProviderContext): Promise<HealthQuoteResult> {
    const def = getFgHealthProduct(req.product);
    const codes = await this.healthCodeResolver(req);
    const build = buildHealthQuotePayload(req, codes, this.healthMeta, ctx.requestId);
    const body = await this.healthCall(build, "health-quote");
    const result = normalizeHealthQuote(body, {
      requestId: ctx.requestId,
      product: req.product,
      line: def.line,
      policyTermYears: req.policyTermYears,
    });
    return assertHealthQuotePriced(result, body);
  }

  async getHealthProposal(
    req: HealthFullQuoteRequest,
    ctx: ProviderContext,
  ): Promise<HealthQuoteResult> {
    const def = getFgHealthProduct(req.product);
    const codes = await this.healthCodeResolver(req);
    const build = buildHealthProposalPayload(req, codes, this.healthMeta, ctx.requestId);
    const body = await this.healthCall(build, "health-proposal");
    return normalizeHealthProposal(body, {
      requestId: ctx.requestId,
      product: req.product,
      line: def.line,
      policyTermYears: req.policyTermYears,
    });
  }

  async issueHealthPolicy(
    req: HealthIssuanceRequest,
    ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    const codes = await this.healthCodeResolver(req);
    const build = buildHealthIssuancePayload(req, codes, this.healthMeta, ctx.requestId);
    const body = await this.healthCall(build, "health-issuance");
    return normalizeHealthIssuance(body, { requestId: ctx.requestId });
  }
}

/** Factory used at startup — loads + validates env config, DB-backed resolvers. */
export function createFgProvider(): FgProvider {
  return new FgProvider({
    config: loadFgConfig(),
    codeResolver: dbCodeResolver,
    healthCodeResolver: dbHealthCodeResolver,
  });
}
