import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { CkycRequest, KycResult, OvdRequest, OvdFile, OvdResult } from "@/contracts/kyc.ts";
import type { CertificateResult, PolicyIssuanceRequest, PolicyIssuanceResult } from "@/contracts/policy.ts";
import { AppError, ProviderError } from "@/errors/app-error.ts";
import type {
  InsuranceProvider,
  ProviderContext,
  KycCapableProvider,
  IssuanceProvider,
  CertificateProvider,
} from "@/providers/insurance-provider.ts";
import { tokenManager } from "@/providers/token-manager.ts";

import {
  HDFC_SLUG,
  HDFC_DISPLAY_NAME,
  HDFC_CAPABILITIES,
  HDFC_OPERATIONS,
  HDFC_MOTOR_CAPABILITIES,
  hdfcEndpointUrl,
  loadHdfcConfig,
  type HdfcConfig,
  type HdfcEndpointName,
} from "./config.ts";
import { hdfcTokenFetcher, hdfcTokenCacheKey, hdfcTransactionId } from "./auth.ts";
import { hdfcCompleteCkyc } from "./ckyc.ts";
import { FetchTransport, assertHdfcSuccess, type HdfcTransport } from "./http.ts";
import {
  toHdfcRequest,
  buildGetCalculateIDV,
  buildCalculatePremium,
  buildCreateProposal,
  buildGetProposalDocument,
  buildSubmitPaymentDetails,
  buildGetPolicyDocument,
} from "./mapper/index.ts";
import {
  normalizeIdv,
  normalizeQuote,
  normalizeProposal,
  normalizeCertificate,
  normalizePayment,
  selectIdvForPremium,
} from "./normalizer.ts";
import { dbCodeResolver, type HdfcCodeResolver } from "./db-code-resolver.ts";
import type { HdfcRequestShape } from "./types.ts";

export interface HdfcProviderDeps {
  config: HdfcConfig;
  transport?: HdfcTransport;
  codeResolver?: HdfcCodeResolver;
  /** Override token acquisition (tests bypass the live authenticate call). */
  tokenProvider?: () => Promise<string>;
}

export class HdfcProvider
  implements InsuranceProvider, KycCapableProvider, IssuanceProvider, CertificateProvider
{
  readonly slug = HDFC_SLUG;
  readonly displayName = HDFC_DISPLAY_NAME;
  readonly capabilities: ReadonlySet<VehicleCategory> = HDFC_CAPABILITIES;
  readonly operations: ReadonlySet<ProviderOperation> = HDFC_OPERATIONS;
  readonly motorCapabilities: MotorCapabilities = HDFC_MOTOR_CAPABILITIES;

  private readonly config: HdfcConfig;
  private readonly transport: HdfcTransport;
  private readonly codeResolver: HdfcCodeResolver;
  private readonly tokenProvider: () => Promise<string>;

  constructor(deps: HdfcProviderDeps) {
    this.config = deps.config;
    this.transport = deps.transport ?? new FetchTransport();
    this.codeResolver = deps.codeResolver ?? dbCodeResolver;
    this.tokenProvider =
      deps.tokenProvider ??
      (() =>
        tokenManager.getToken(
          hdfcTokenCacheKey(this.config),
          hdfcTokenFetcher(this.config, this.transport),
        ));
  }

  private headers(token: string): Record<string, string> {
    return {
      SOURCE: this.config.source,
      CHANNEL_ID: this.config.channelId,
      PRODUCT_CODE: this.config.productCode,
      TOKEN: token,
    };
  }

  /** One HEI call: build URL + headers, POST, assert HDFC's own status. */
  private async call(
    endpoint: HdfcEndpointName,
    token: string,
    jsonBody: unknown,
    step: string,
    idempotent = false,
  ): Promise<unknown> {
    const body = await this.transport.request({
      method: "POST",
      url: hdfcEndpointUrl(this.config, endpoint),
      headers: this.headers(token),
      jsonBody,
      idempotent,
    });
    assertHdfcSuccess(body, step);
    return body;
  }

  /**
   * IDV then premium. HDFC recomputes the premium from the payload on every
   * call — there is no retrieve-quote — so this is the whole quote flow.
   */
  private async priceQuote(
    req: MotorQuoteRequest,
    ctx: ProviderContext,
    transactionId: string,
  ): Promise<{ shape: HdfcRequestShape; quote: CanonicalQuoteResult; token: string }> {
    const token = await this.tokenProvider();
    const codes = await this.codeResolver(req);
    const shape = toHdfcRequest(req, codes, transactionId);

    const idvBody = await this.call(
      "getCalculateIDV",
      token,
      buildGetCalculateIDV(shape),
      "getCalculateIDV",
      true,
    );
    const band = normalizeIdv(idvBody);

    // HDFC rejects any deviation from its recommendation. Always price with it.
    const idv = selectIdvForPremium(band, shape.vehicle.idv);
    if (idv) shape.vehicle.idv = idv;

    const premiumBody = await this.call(
      "calculatePremium",
      token,
      buildCalculatePremium(shape),
      "calculatePremium",
      true,
    );

    const quote = normalizeQuote(premiumBody, {
      requestId: ctx.requestId,
      quoteNo: transactionId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
    });

    return {
      shape,
      token,
      quote: { ...quote, minIdv: band.min ?? undefined, maxIdv: band.max ?? undefined },
    };
  }

  async getQuote(req: MotorQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    const { quote } = await this.priceQuote(req, ctx, hdfcTransactionId("QT"));
    return quote;
  }

  async getFullQuote(
    req: MotorFullQuoteRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    // HDFC's rule: never proceed when KYC is unverified. The Pehchaan id is the
    // proof, and it becomes Customer_Pehchaan_id on the proposal.
    if (!req.kycRefId && !req.ckyc) {
      throw new AppError(
        422,
        "HDFC requires a verified Pehchaan KYC id before a proposal can be created",
        "KYC_INCOMPLETE",
      );
    }

    const transactionId = req.quoteId || hdfcTransactionId("PROP");
    const { shape, quote, token } = await this.priceQuote(req, ctx, transactionId);

    const proposalBody = await this.call(
      "createProposal",
      token,
      buildCreateProposal(shape),
      "createProposal",
    );
    const { proposalNumber } = normalizeProposal(proposalBody);
    if (!proposalNumber) {
      throw new ProviderError(
        HDFC_SLUG,
        502,
        "HDFC createProposal returned no proposal number",
        proposalBody,
      );
    }

    shape.proposalNumber = proposalNumber;
    const proposalDoc = await this.call(
      "getProposalDocument",
      token,
      buildGetProposalDocument(shape),
      "getProposalDocument",
      true,
    );

    return {
      ...quote,
      contractDetails: { proposalNumber, transactionId },
      _rawResponse: { premium: quote._rawResponse, proposal: proposalBody, proposalDoc },
    };
  }

  /** Pehchaan e-KYC. */
  async completeCkyc(req: CkycRequest, _ctx: ProviderContext): Promise<KycResult> {
    return hdfcCompleteCkyc(this.config, req);
  }

  /**
   * Present only to satisfy supportsKyc()'s type-guard, which requires both KYC
   * methods. "ovd" is NOT in `operations`, so requireOperation rejects the route
   * first; this is the belt-and-braces path.
   */
  async initiateOvd(_req: OvdRequest, _files: OvdFile[], _ctx: ProviderContext): Promise<OvdResult> {
    throw new AppError(
      501,
      "HDFC does not support OVD document upload — documents are captured inside the Pehchaan hosted journey",
      "NOT_IMPLEMENTED",
    );
  }

  /**
   * HDFC has no hosted payment gateway: submitpaymentdetails RECORDS a payment
   * already collected. The canonical PaymentReceipt therefore maps directly onto
   * its Payment_Details block.
   */
  async issuePolicy(
    req: PolicyIssuanceRequest,
    _ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    const token = await this.tokenProvider();
    // quoteNo carries HDFC's Proposal_Number; transactionId is the cross-step id.
    const transactionId = req.transactionId ?? req.clientId;
    const shape = {
      transactionId,
      proposalNumber: req.quoteNo,
      payment: {
        amount: req.receipt.amount,
        instrumentNumber: req.receipt.tranRefNo,
        paymentDate: req.receipt.tranRefNoDate,
        bankName: req.receipt.pgType,
      },
    } as HdfcRequestShape;

    const paymentBody = await this.call(
      "submitPaymentDetails",
      token,
      buildSubmitPaymentDetails(shape),
      "submitPaymentDetails",
    );
    const { policyNumber } = normalizePayment(paymentBody);

    if (!policyNumber) {
      return {
        providerSlug: HDFC_SLUG,
        insurerName: HDFC_DISPLAY_NAME,
        status: "IN_PROGRESS",
        quoteNo: req.quoteNo,
        clientId: req.clientId,
        message: "HDFC accepted the payment but has not issued a policy number yet",
        _rawResponse: paymentBody,
      };
    }

    shape.policyNumber = policyNumber;
    const policyDoc = await this.call(
      "getPolicyDocument",
      token,
      buildGetPolicyDocument(shape),
      "getPolicyDocument",
      true,
    );

    return {
      providerSlug: HDFC_SLUG,
      insurerName: HDFC_DISPLAY_NAME,
      status: "ISSUED",
      policyNumber,
      applicationNo: req.quoteNo,
      receiptNo: req.receipt.tranRefNo,
      clientId: req.clientId,
      quoteNo: req.quoteNo,
      _rawResponse: { payment: paymentBody, policyDocument: policyDoc },
    };
  }

  async getCertificate(transactionId: string, _ctx: ProviderContext): Promise<CertificateResult> {
    const token = await this.tokenProvider();
    const body = await this.call(
      "getPolicyDocument",
      token,
      { TransactionID: hdfcTransactionId("COI"), Req_Policy_Document: { Policy_Number: transactionId } },
      "getPolicyDocument",
      true,
    );
    return normalizeCertificate(body);
  }
}

/** Factory used at startup — env config + DB-backed code resolver. */
export function createHdfcProvider(): HdfcProvider {
  return new HdfcProvider({ config: loadHdfcConfig(), codeResolver: dbCodeResolver });
}
