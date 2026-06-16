import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { CkycRequest, KycResult, OvdRequest, OvdFile, OvdResult } from "@/contracts/kyc.ts";
import type { PolicyStatusRequest, PolicyStatusResult, CertificateResult } from "@/contracts/policy.ts";
import type {
  InsuranceProvider,
  ProviderContext,
  QuoteRetrievalProvider,
  KycCapableProvider,
  PolicyStatusProvider,
  CertificateProvider,
} from "@/providers/insurance-provider.ts";
import { tokenManager } from "@/providers/token-manager.ts";

import {
  ICICI_SLUG,
  ICICI_DISPLAY_NAME,
  ICICI_CAPABILITIES,
  ICICI_OPERATIONS,
  ICICI_MOTOR_CAPABILITIES,
  loadIciciConfig,
  type IciciConfig,
} from "./config.ts";
import { iciciTokenFetcher } from "./auth.ts";
import { FetchTransport, assertIciciSuccess, type IciciTransport } from "./http.ts";
import {
  endpoints,
  resolveLine,
  buildSaveQuotePayload,
  buildProposalPayload,
  buildCkycPayload,
  buildPolicyStatusPayload,
  buildOvdFormData,
  type IciciResolvedCodes,
} from "./mapper.ts";
import {
  normalizeQuote,
  normalizeProposal,
  normalizeCkyc,
  normalizeOvd,
  normalizePolicyStatus,
  normalizeCertificate,
} from "./normalizer.ts";
import { dbCodeResolver } from "./db-code-resolver.ts";

/** Resolves canonical IDs → ICICI master codes. */
export type IciciCodeResolver = (req: MotorQuoteRequest) => Promise<IciciResolvedCodes>;

/** Dev/fixtures resolver: canonical IDs are already the ICICI numeric codes. */
export const passthroughCodeResolver: IciciCodeResolver = async (req) => ({
  makeCode: Number(req.makeId),
  modelCode: Number(req.modelId),
  rtoCode: Number(req.rtoCode),
  previousInsurerCode: req.previousInsurerId,
});

export interface IciciProviderDeps {
  config: IciciConfig;
  transport?: IciciTransport;
  codeResolver?: IciciCodeResolver;
  /** Override token acquisition (tests bypass the live auth call). */
  tokenProvider?: () => Promise<string>;
}

export class IciciProvider
  implements
    InsuranceProvider,
    QuoteRetrievalProvider,
    KycCapableProvider,
    PolicyStatusProvider,
    CertificateProvider
{
  readonly slug = ICICI_SLUG;
  readonly displayName = ICICI_DISPLAY_NAME;
  readonly capabilities: ReadonlySet<VehicleCategory> = ICICI_CAPABILITIES;
  readonly operations: ReadonlySet<ProviderOperation> = ICICI_OPERATIONS;
  readonly motorCapabilities: MotorCapabilities = ICICI_MOTOR_CAPABILITIES;

  private readonly config: IciciConfig;
  private readonly transport: IciciTransport;
  private readonly codeResolver: IciciCodeResolver;
  private readonly tokenProvider: () => Promise<string>;

  constructor(deps: IciciProviderDeps) {
    this.config = deps.config;
    this.transport = deps.transport ?? new FetchTransport();
    this.codeResolver = deps.codeResolver ?? passthroughCodeResolver;
    this.tokenProvider =
      deps.tokenProvider ??
      (() =>
        tokenManager.getToken(
          `${ICICI_SLUG}:${this.config.credentialSetId}`,
          iciciTokenFetcher(this.config),
        ));
  }

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  async getQuote(req: MotorQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    const token = await this.tokenProvider();
    const codes = await this.codeResolver(req);
    const { url, payload } = buildSaveQuotePayload(req, codes, ctx.requestId);

    const body = await this.transport.request({ method: "POST", url: this.url(url), token, jsonBody: payload });
    assertIciciSuccess(body, "save-quote");

    return normalizeQuote(body, {
      requestId: ctx.requestId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
    });
  }

  async retrieveQuote(
    transactionId: string,
    category: VehicleCategory,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    const token = await this.tokenProvider();
    const line = resolveLine(category);
    const body = await this.transport.request({
      method: "GET",
      url: this.url(endpoints.getQuote(line, transactionId)),
      token,
    });
    assertIciciSuccess(body, "get-quote");
    return normalizeQuote(body, {
      requestId: ctx.requestId,
      policyType: "comprehensive",
      vehicleCategory: category,
    });
  }

  async getFullQuote(
    req: MotorFullQuoteRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    const token = await this.tokenProvider();
    const line = resolveLine(req.vehicleType);

    // 1. Pull the premium context the proposal is built against.
    const quoteBody = await this.transport.request({
      method: "GET",
      url: this.url(endpoints.getQuote(line, req.quoteId)),
      token,
    });
    assertIciciSuccess(quoteBody, "get-quote");
    const base = normalizeQuote(quoteBody, {
      requestId: ctx.requestId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
    });

    // 2. Submit the proposal.
    const codes = await this.codeResolver(req);
    const { url, payload } = buildProposalPayload(req, codes, ctx.requestId);
    const proposalBody = await this.transport.request({
      method: "POST",
      url: this.url(url),
      token,
      jsonBody: payload,
    });
    assertIciciSuccess(proposalBody, "proposal");
    const overlay = normalizeProposal(proposalBody);

    return {
      ...base,
      policyNumber: overlay.policyNumber,
      paymentUrl: overlay.paymentUrl,
      policyStartDate: overlay.policyStartDate ?? base.policyStartDate,
      policyEndDate: overlay.policyEndDate ?? base.policyEndDate,
      contractDetails: overlay.contractDetails,
      _rawResponse: { quote: quoteBody, proposal: proposalBody },
    };
  }

  async completeCkyc(req: CkycRequest, _ctx: ProviderContext): Promise<KycResult> {
    const token = await this.tokenProvider();
    const body = await this.transport.request({
      method: "POST",
      url: this.url(endpoints.ckyc()),
      token,
      jsonBody: buildCkycPayload(req),
    });
    assertIciciSuccess(body, "ckyc");
    return normalizeCkyc(body);
  }

  async initiateOvd(req: OvdRequest, files: OvdFile[], _ctx: ProviderContext): Promise<OvdResult> {
    const token = await this.tokenProvider();
    const body = await this.transport.request({
      method: "POST",
      url: this.url(endpoints.ovd()),
      token,
      formData: buildOvdFormData(req, files),
    });
    assertIciciSuccess(body, "ovd");
    return normalizeOvd(body);
  }

  async getPolicyStatus(
    req: PolicyStatusRequest,
    _ctx: ProviderContext,
  ): Promise<PolicyStatusResult> {
    const token = await this.tokenProvider();
    const body = await this.transport.request({
      method: "POST",
      url: this.url(endpoints.policyStatus()),
      token,
      jsonBody: buildPolicyStatusPayload(req.transactionId),
    });
    assertIciciSuccess(body, "policy-status");
    return normalizePolicyStatus(body);
  }

  async getCertificate(transactionId: string, _ctx: ProviderContext): Promise<CertificateResult> {
    const token = await this.tokenProvider();
    const body = await this.transport.request({
      method: "POST",
      url: this.url(endpoints.certificate(transactionId)),
      token,
    });
    assertIciciSuccess(body, "coi");
    return normalizeCertificate(body);
  }
}

/** Factory used at startup — loads + validates env config, DB-backed code resolver. */
export function createIciciProvider(): IciciProvider {
  return new IciciProvider({ config: loadIciciConfig(), codeResolver: dbCodeResolver });
}
