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
import { AppError, ProviderError } from "@/errors/app-error.ts";
import { tokenManager, type TokenFetcher } from "@/providers/token-manager.ts";
import { logger } from "@/lib/logger.ts";

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
import { fgVerifyCkyc, fgGetCkycStatus, fgUploadDocBytes, fgCkycDocType } from "./ckyc.ts";
import { fgRenewalQuote, fgRenewalCreatePolicy } from "./renewal.ts";
import { createInspection, getInspectionStatus, inspectionRequired } from "./inspection.ts";
import { FetchTransport, assertFgSuccess, type FgTransport } from "./http.ts";
import {
  buildGetQuotePayload,
  buildCreateProposalPayload,
  buildIssueProposalPayload,
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

/**
 * A product token with its cache handle: `get` serves the cached token (minting
 * when stale); `invalidate` drops it so the next get mints fresh — used when FG
 * rejects a token (401) ahead of its advertised TTL.
 */
interface FgTokenHandle {
  get(): Promise<string>;
  invalidate(): void;
}

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
  private readonly motorToken: FgTokenHandle;
  private readonly ckycToken: FgTokenHandle;
  private readonly renewalToken: FgTokenHandle;
  private readonly healthToken: FgTokenHandle;
  private readonly healthCodeResolver: FgHealthCodeResolver;

  constructor(deps: FgProviderDeps) {
    this.config = deps.config;
    this.transport = deps.transport ?? new FetchTransport();
    this.codeResolver = deps.codeResolver ?? passthroughCodeResolver;
    // The fetcher is built lazily (first token get), not in the constructor —
    // tests construct providers from partial configs with overridden tokens.
    const handle = (
      override: (() => Promise<string>) | undefined,
      cacheKey: string,
      makeFetcher: () => TokenFetcher,
    ): FgTokenHandle =>
      override
        ? { get: override, invalidate: () => {} }
        : {
            get: () => tokenManager.getToken(cacheKey, makeFetcher()),
            invalidate: () => tokenManager.invalidate(cacheKey),
          };
    this.motorToken = handle(
      deps.tokenProvider,
      `${FG_SLUG}:${this.config.credentialSetId}`,
      () => fgTokenFetcher(this.config),
    );
    this.ckycToken = handle(
      deps.ckycTokenProvider,
      `${FG_SLUG}-ckyc:${this.config.credentialSetId}`,
      () => fgProductTokenFetcher(this.config, this.config.ckyc),
    );
    this.renewalToken = handle(
      deps.renewalTokenProvider,
      `${FG_SLUG}-renewal:${this.config.credentialSetId}`,
      () => fgProductTokenFetcher(this.config, this.config.renewal),
    );
    this.healthToken = handle(
      deps.healthTokenProvider,
      `${FG_SLUG}-health:${this.config.credentialSetId}`,
      () => fgProductTokenFetcher(this.config, this.config.health),
    );
    this.healthCodeResolver = deps.healthCodeResolver ?? passthroughHealthResolver;
  }

  /**
   * FG's gateway invalidates bearer tokens ahead of their advertised TTL
   * (live-observed 2026-07-14: a cached, unexpired token 401s while a fresh
   * mint succeeds; FG's doc says to mint per request). On a 401, drop the
   * cached token and retry the call once with a freshly minted one.
   */
  private async withAuthRetry<T>(
    tokenHandle: FgTokenHandle,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    const token = await tokenHandle.get();
    try {
      return await fn(token);
    } catch (err) {
      if (!(err instanceof ProviderError) || err.upstreamStatus !== 401) throw err;
      tokenHandle.invalidate();
      logger.warn({ provider: FG_SLUG }, "FG rejected cached token (401); retrying with a fresh token");
      return fn(await tokenHandle.get());
    }
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
    const codes = await this.codeResolver(req);
    const { url, payload } = buildGetQuotePayload(req, codes, this.meta, ctx.requestId);

    const body = await this.withAuthRetry(this.motorToken, (token) =>
      this.transport.request({
        method: "POST",
        url: this.url(url),
        token,
        jsonBody: payload,
      }),
    );
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
    // FG rejects break-in proposals without inspection evidence ("This is a
    // break-in Scenario, So please pass the inspection details"). Fail fast
    // with a typed code so the frontend can run the inspection flow instead
    // of parsing FG's error text.
    if (inspectionRequired(req) && !req.inspectionReportNumber) {
      throw new AppError(
        422,
        "FG requires a completed vehicle inspection for this journey (break-in). Complete the inspection and resubmit with its report number.",
        "INSPECTION_REQUIRED",
      );
    }

    // FG has no "retrieve quote by id" — CreateProposal (CRT) is built directly
    // against the prior QuotationNumber (req.quoteId → strpolicyquoteNumber) and
    // returns the (bound) premium in the same response shape as a quote.
    const codes = await this.codeResolver(req);
    const { url, payload } = buildCreateProposalPayload(req, codes, this.meta, ctx.requestId);

    const body = await this.withAuthRetry(this.motorToken, (token) =>
      this.transport.request({
        method: "POST",
        url: this.url(url),
        token,
        jsonBody: payload,
      }),
    );
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
    // (ClientID + QuotationNo) and issue the real policy. Same JSON transport.
    const { url, payload } = buildIssueProposalPayload(req, this.meta, ctx.requestId);

    const body = await this.withAuthRetry(this.motorToken, (token) =>
      this.transport.request({
        method: "POST",
        url: this.url(url),
        token,
        jsonBody: payload,
      }),
    );
    assertFgSuccess(extractRoot(body), "policy-issuance");

    return normalizeIssuance(body, { quoteNo: req.quoteNo });
  }

  async completeCkyc(req: CkycRequest, _ctx: ProviderContext): Promise<KycResult> {
    const result = await this.withAuthRetry(this.ckycToken, (token) =>
      fgVerifyCkyc(this.config, req, token),
    );
    // A registry auto-match already carries the CKYC number in the VerifyCKYC
    // response; only fall back to the status poll when it is missing (manual
    // document-upload cases deliver the number there once the upload clears).
    const proposalId = result.proposalId;
    if (result.isKycSuccess && proposalId && !result.ckycNumber) {
      try {
        const status = await this.withAuthRetry(this.ckycToken, (token) =>
          fgGetCkycStatus(this.config, proposalId, token),
        );
        if (status.ckycNumber) {
          result.ckycNumber = status.ckycNumber;
          result.kycId = status.ckycNumber;
        } else {
          // Matched case but FG hasn't finalised the KYC record yet — the
          // frontend re-polls; keep the proposalId link and say why.
          result.displayMessage = status.message ?? result.displayMessage;
          logger.warn(
            { proposalId, kycFinalStatus: status.status, kycMessage: status.message },
            "FG CKYC matched but no CKYC number yet",
          );
        }
      } catch (err) {
        // Best-effort: the proposalId still links the verified KYC.
        logger.warn({ err, proposalId }, "FG CKYC status lookup failed");
      }
    }
    return result;
  }

  async initiateOvd(req: OvdRequest, files: OvdFile[], ctx: ProviderContext): Promise<OvdResult> {
    // FG's manual-KYC document upload (GCKYC/3.0.0 UploadDocBytes) — used when the
    // redirect URL cannot be shown. The document is attached to the pending CKYC
    // case via its VerifyCKYC proposalId; the CKYC number arrives later via
    // GetKycStatus, so a verified upload just unblocks that poll.
    const file = files.find((f) => f.fieldName === "proofOfIdentity") ?? files[0];
    if (!file) {
      throw new AppError(422, "FG CKYC document upload requires a document file", "OVD_FILE_REQUIRED");
    }
    if (!req.proposalId) {
      throw new AppError(
        422,
        "FG CKYC document upload requires the CKYC proposalId from VerifyCKYC",
        "OVD_PROPOSAL_REQUIRED",
      );
    }
    // Derive doc_type from the CHOSEN file's role, not always proofOfIdentity: the
    // fallback (files[0]) can be the proofOfAddress file, whose declared kind is
    // proofOfAddressType — using proofOfIdentityType there would mislabel the doc.
    const idType =
      file.fieldName === "proofOfAddress" ? req.proofOfAddressType : req.proofOfIdentityType;
    const result = await this.withAuthRetry(this.ckycToken, (token) =>
      fgUploadDocBytes(
        this.config,
        {
          reqId: ctx.requestId,
          proposalId: req.proposalId!,
          docType: fgCkycDocType(file.mimeType, idType),
          docBase64: file.buffer.toString("base64"),
        },
        token,
      ),
    );
    return {
      kycId: result.proposalId,
      proposalId: result.proposalId,
      customerName: result.extractedName,
      isKycSuccess: result.isVerified,
      displayMessage: result.message,
      _rawResponse: result.raw,
    };
  }

  async renewalQuote(req: RenewalQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    return this.withAuthRetry(this.renewalToken, (token) =>
      fgRenewalQuote(this.config, req, token, { requestId: ctx.requestId }),
    );
  }

  async renewalCreatePolicy(
    req: RenewalCreatePolicyRequest,
    _ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    return this.withAuthRetry(this.renewalToken, (token) =>
      fgRenewalCreatePolicy(this.config, req, token),
    );
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
    const body = await this.withAuthRetry(this.healthToken, (token) =>
      this.transport.request({
        method: "POST",
        url: this.config.health.baseUrl,
        token,
        xmlBody: buildHealthSoapEnvelope(build.method, build.soapProduct, build.payload),
        soapAction: build.soapAction,
      }),
    );
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
