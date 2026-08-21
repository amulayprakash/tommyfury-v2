import type { VehicleCategory, ProviderOperation, MotorCapabilities } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { CkycRequest, KycResult, OvdRequest, OvdFile, OvdResult } from "@/contracts/kyc.ts";
import type {
  CertificateResult,
  PaymentReceipt,
  PolicyIssuanceRequest,
  PolicyIssuanceResult,
} from "@/contracts/policy.ts";
import type {
  RenewalQuoteRequest,
  RenewalProposalRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
import { AppError, ProviderError } from "@/errors/app-error.ts";
import type {
  InsuranceProvider,
  ProviderContext,
  KycCapableProvider,
  IssuanceProvider,
  CertificateProvider,
  RenewalProvider,
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
  assertAccessorySiWithinCap,
  buildGetCalculateIDV,
  buildCalculatePremium,
  buildCreateProposal,
  buildGetProposalDocument,
  buildSubmitPaymentDetails,
  buildGetPolicyDocument,
} from "./mapper/index.ts";
import {
  buildRenewalExtract,
  buildRenewalGetCalculateIDV,
  buildRenewalCalculatePremium,
  buildRenewalCreateProposal,
  type HdfcRenewalInput,
} from "./mapper/renewal.ts";
import {
  normalizeIdv,
  normalizeQuote,
  normalizeProposal,
  normalizeCertificate,
  normalizePayment,
  normalizeRenewalExtract,
  canonicalPolicyType,
  selectIdvForPremium,
  type HdfcIdvBand,
  type HdfcRenewalSnapshot,
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
  implements
    InsuranceProvider,
    KycCapableProvider,
    IssuanceProvider,
    CertificateProvider,
    RenewalProvider
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

    // The accessory cap is measured against the vehicle SI, which only exists
    // once HDFC has recommended one — so it is judged here, not in the mapper.
    // HDFC stated the rule and stopped enforcing it; see assertAccessorySiWithinCap.
    assertAccessorySiWithinCap(shape);

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
   * submitPaymentDetails → getPolicyDocument, shared by new-business issuance and
   * renewal issuance. HDFC's step 06/07 pair is identical for both: only the way
   * the proposal number was obtained differs, so keeping one implementation stops
   * the two paths drifting apart.
   */
  private async recordPaymentAndIssue(args: {
    transactionId: string;
    proposalNumber: string;
    receipt: PaymentReceipt;
    clientId?: string;
  }): Promise<PolicyIssuanceResult> {
    const token = await this.tokenProvider();
    const shape = {
      transactionId: args.transactionId,
      proposalNumber: args.proposalNumber,
      payment: {
        amount: args.receipt.amount,
        instrumentNumber: args.receipt.tranRefNo,
        paymentDate: args.receipt.tranRefNoDate,
        bankName: args.receipt.pgType,
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
        quoteNo: args.proposalNumber,
        clientId: args.clientId,
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
      applicationNo: args.proposalNumber,
      receiptNo: args.receipt.tranRefNo,
      clientId: args.clientId,
      quoteNo: args.proposalNumber,
      _rawResponse: { payment: paymentBody, policyDocument: policyDoc },
    };
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
    // quoteNo carries HDFC's Proposal_Number; transactionId is the cross-step id.
    return this.recordPaymentAndIssue({
      transactionId: req.transactionId ?? req.clientId,
      proposalNumber: req.quoteNo,
      receipt: req.receipt,
      clientId: req.clientId,
    });
  }

  // ── Renewal (HDFC Postman "Renewal" folder, steps 02–08) ───────────────────
  //
  // Renewal is keyed by policy number alone. Step 02 (getpolicydataforrenewal)
  // returns the expiring-policy snapshot, and it is the ONLY source for the IDV,
  // the cover block and Customer_Details that steps 03–05 need — the canonical
  // renewal contract carries none of them. Both renewalQuote and renewalProposal
  // therefore begin by re-reading it; the call is read-only and idempotent.
  //
  // HDFC calls `requireFields` nowhere: everything it needs (previousPolicyNo /
  // policyNo, proposalNo, receipt) is still mandatory in the relaxed schemas.
  // The fields that became optional are FG's alone.

  /** Renewal step 02 → the expiring-policy snapshot. */
  private async renewalSnapshot(
    token: string,
    transactionId: string,
    policyNo: string,
  ): Promise<HdfcRenewalSnapshot> {
    const body = await this.call(
      "renewalExtract",
      token,
      buildRenewalExtract(transactionId, policyNo),
      "renewalExtract",
      true,
    );
    return normalizeRenewalExtract(body);
  }

  /**
   * Renewal step 03. HDFC's GetCalculateIDV is keyed by model + RTO code, which
   * only the snapshot can supply; when it carries neither, the call is skipped
   * and the expiring policy's own IDV stands, rather than sending blank codes and
   * earning an opaque vendor rejection.
   */
  private async renewalIdv(
    token: string,
    transactionId: string,
    snap: HdfcRenewalSnapshot,
  ): Promise<{ idv: number; band?: HdfcIdvBand }> {
    if (!snap.modelCode || !snap.rtoCode) return { idv: snap.idv };
    const body = await this.call(
      "getCalculateIDV",
      token,
      buildRenewalGetCalculateIDV(transactionId, snap),
      "getCalculateIDV",
      true,
    );
    const band = normalizeIdv(body);
    // Same rule as new business: HDFC rejects deviation from its recommendation.
    return { idv: selectIdvForPremium(band, snap.idv) ?? snap.idv, band };
  }

  async renewalQuote(
    req: RenewalQuoteRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    const token = await this.tokenProvider();
    const transactionId = hdfcTransactionId("REN");
    const snap = await this.renewalSnapshot(token, transactionId, req.policyNo);
    const { idv, band } = await this.renewalIdv(token, transactionId, snap);

    const premiumBody = await this.call(
      "calculatePremium",
      token,
      buildRenewalCalculatePremium({
        transactionId,
        previousPolicyNo: req.policyNo,
        registrationNo: req.registrationNo ?? snap.registrationNo,
        idv,
        policyType: snap.policyType,
        tenure: snap.tenure,
      }),
      "calculatePremium",
      true,
    );

    const quote = normalizeQuote(premiumBody, {
      requestId: ctx.requestId,
      quoteNo: transactionId,
      policyType: canonicalPolicyType(snap.policyType),
      // PRODUCT_CODE 2311 is Private Car; HDFC ships no other renewal product.
      vehicleCategory: "fourWheeler",
    });

    return {
      ...quote,
      minIdv: band?.min ?? undefined,
      maxIdv: band?.max ?? undefined,
      contractDetails: {
        previousPolicyNo: req.policyNo,
        transactionId,
        registrationNo: snap.registrationNo,
      },
    };
  }

  async renewalProposal(
    req: RenewalProposalRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    const token = await this.tokenProvider();
    // Reuse the quote's TransactionID when the caller threads it through: HDFC
    // correlates every renewal step by it.
    const transactionId = req.transactionId ?? hdfcTransactionId("REN");
    const snap = await this.renewalSnapshot(token, transactionId, req.previousPolicyNo);

    const input: HdfcRenewalInput = {
      transactionId,
      previousPolicyNo: req.previousPolicyNo,
      registrationNo: req.registrationNo ?? snap.registrationNo,
      // The caller's IDV wins when supplied; otherwise the expiring policy's.
      idv: req.vehicleIdv || snap.idv,
      policyType: snap.policyType,
      tenure: snap.tenure,
      customer: snap.customer,
    };

    const premiumBody = await this.call(
      "calculatePremium",
      token,
      buildRenewalCalculatePremium(input),
      "calculatePremium",
      true,
    );
    const quote = normalizeQuote(premiumBody, {
      requestId: ctx.requestId,
      quoteNo: transactionId,
      policyType: canonicalPolicyType(snap.policyType),
      vehicleCategory: "fourWheeler",
    });

    const proposalBody = await this.call(
      "createProposal",
      token,
      buildRenewalCreateProposal(input),
      "createProposal",
    );
    const { proposalNumber } = normalizeProposal(proposalBody);
    if (!proposalNumber) {
      throw new ProviderError(
        HDFC_SLUG,
        502,
        "HDFC renewal createProposal returned no proposal number",
        proposalBody,
      );
    }

    return {
      ...quote,
      contractDetails: {
        proposalNumber,
        transactionId,
        previousPolicyNo: req.previousPolicyNo,
      },
      _rawResponse: { premium: quote._rawResponse, proposal: proposalBody },
    };
  }

  async renewalCreatePolicy(
    req: RenewalCreatePolicyRequest,
    _ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    // proposalNo carries HDFC's own Proposal_Number (not FG's "00"+policy form).
    return this.recordPaymentAndIssue({
      transactionId: req.transactionId ?? req.proposalNo,
      proposalNumber: req.proposalNo,
      receipt: req.receipt,
      clientId: req.clientId,
    });
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
