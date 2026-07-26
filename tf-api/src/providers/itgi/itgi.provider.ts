import type {
  VehicleCategory,
  ProviderOperation,
  MotorCapabilities,
} from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { CkycRequest, KycResult, OvdRequest, OvdFile, OvdResult } from "@/contracts/kyc.ts";
import type {
  PolicyIssuanceRequest,
  PolicyIssuanceResult,
  PolicyStatusRequest,
  PolicyStatusResult,
  CertificateResult,
} from "@/contracts/policy.ts";
import type {
  InsuranceProvider,
  KycCapableProvider,
  IssuanceProvider,
  PolicyStatusProvider,
  CertificateProvider,
  ProviderContext,
} from "../insurance-provider.ts";
import { AppError } from "@/errors/app-error.ts";

import {
  ITGI_SLUG,
  ITGI_DISPLAY_NAME,
  ITGI_CAPABILITIES,
  ITGI_OPERATIONS,
  ITGI_MOTOR_CAPABILITIES,
  ITGI_ENDPOINTS,
  itgiConfig,
  type ItgiConfig,
} from "./config.ts";
import { soapEnvelope, ITGI_NS, type ItgiTransport } from "./http.ts";
import { type ItgiCodeResolver, type ItgiCodes } from "./db-code-resolver.ts";
import { selectPolicyPath, type ItgiPolicyPath } from "./policy-types/index.ts";
import {
  buildIdvPayload,
  buildPremiumPayload,
  buildCoverageItems,
  hasElectedAddons,
  type ItgiPartnerDetails,
} from "./mapper.ts";
import { normalizeIdv, normalizeQuote } from "./normalizer.ts";
import { buildProposalPayload, parseProposalResponse } from "./proposal.ts";
import { buildPaymentPayload, parsePaymentResponse } from "./payment.ts";
import { buildStatusPayload, parseStatusResponse } from "./policy-status.ts";
import { itgiDownloadPolicy } from "./certificate.ts";
import {
  itgiKycFetch,
  itgiKycValidateOtp,
  itgiKycCreate,
  toCkycDate,
  type ItgiKycDocument,
} from "./ckyc.ts";
import {
  toItgiDate,
  toItgiDateTime,
  itgiContractType,
  makeUniqueQuoteId,
  splitRegistrationNumber,
} from "./format.ts";

export interface ItgiProviderDeps {
  transport: ItgiTransport;
  resolveCodes: ItgiCodeResolver;
  /** Overridable so tests need no env. */
  config?: ItgiConfig;
}

/** Adds N days to an ISO date, returning ISO. */
function addDays(iso: string, days: number): string {
  if (!days) return iso;
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * IFFCO-Tokio motor adapter.
 *
 * Hybrid vendor: SOAP/XML for the motor lifecycle, REST/JSON for CKYC and policy
 * download. There is no token manager — SOAP auth is the partner code carried in
 * the request body plus (presumed) IP whitelisting.
 *
 * The state chain threaded through the lifecycle is:
 *   uniqueQuoteId (ours) → orderNo + traceNo (proposal) → policyNumber (payment)
 */
export class ItgiProvider
  implements
    InsuranceProvider,
    KycCapableProvider,
    IssuanceProvider,
    PolicyStatusProvider,
    CertificateProvider
{
  readonly slug = ITGI_SLUG;
  readonly displayName = ITGI_DISPLAY_NAME;
  readonly capabilities: ReadonlySet<VehicleCategory> = ITGI_CAPABILITIES;
  readonly operations: ReadonlySet<ProviderOperation> = ITGI_OPERATIONS;
  readonly motorCapabilities: MotorCapabilities = ITGI_MOTOR_CAPABILITIES;

  private readonly transport: ItgiTransport;
  private readonly resolveCodes: ItgiCodeResolver;
  private readonly config: ItgiConfig;

  constructor(deps: ItgiProviderDeps) {
    this.transport = deps.transport;
    this.resolveCodes = deps.resolveCodes;
    this.config = deps.config ?? itgiConfig();
  }

  private get partner(): ItgiPartnerDetails {
    return {
      partnerCode: this.config.partnerCode,
      partnerBranch: this.config.partnerBranch,
      partnerSubBranch: this.config.partnerSubBranch,
      responseUrl: this.config.responseUrl,
    };
  }

  private soap(url: string, body: string, ns: Record<string, string>, requestId: string) {
    return this.transport.soap(url, soapEnvelope(body, ns), { requestId });
  }

  /** IDV → premium. Shared by getQuote and getFullQuote. */
  private async priceVehicle(
    req: MotorQuoteRequest,
    ctx: ProviderContext,
  ): Promise<{
    codes: ItgiCodes;
    path: ItgiPolicyPath;
    idv: { idv: number; minIdv: number; maxIdv: number };
    premiumBody: unknown;
    inception: string;
    expiry: string;
  }> {
    const codes = await this.resolveCodes(req);
    const path = selectPolicyPath(req);

    // Break-in inception is read as date+3 (inspection happens at ITGI's end).
    const requested = req.policyStartDate ?? new Date().toISOString().slice(0, 10);
    const inception = addDays(requested, path.inceptionOffsetDays);
    const expiry = req.policyEndDate ?? inception;
    const dated: MotorQuoteRequest = { ...req, policyStartDate: inception, policyEndDate: expiry };

    const idvBody = await this.soap(
      ITGI_ENDPOINTS.idv(this.config),
      buildIdvPayload(dated, codes),
      ITGI_NS.premium,
      ctx.requestId,
    );
    const idv = normalizeIdv(idvBody);

    // Honour a customer-chosen IDV inside the vendor's allowed band.
    const chosen = req.idvValue && req.idvValue >= idv.minIdv && req.idvValue <= idv.maxIdv
      ? req.idvValue
      : idv.idv;

    const premiumBody = await this.soap(
      path.usesNewVehicleEndpoint
        ? ITGI_ENDPOINTS.newVehiclePremium(this.config)
        : ITGI_ENDPOINTS.premium(this.config),
      buildPremiumPayload({ ...dated, idvValue: chosen }, codes, path, this.partner),
      ITGI_NS.premium,
      ctx.requestId,
    );

    return { codes, path, idv: { ...idv, idv: chosen }, premiumBody, inception, expiry };
  }

  async getQuote(req: MotorQuoteRequest, ctx: ProviderContext): Promise<CanonicalQuoteResult> {
    const { path, idv, premiumBody, inception, expiry } = await this.priceVehicle(req, ctx);
    return normalizeQuote(premiumBody, {
      requestId: ctx.requestId,
      quoteNo: makeUniqueQuoteId(ctx.requestId),
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
      idvValue: idv.idv,
      minIdv: idv.minIdv,
      maxIdv: idv.maxIdv,
      hasAddons: hasElectedAddons(req),
      policyStartDate: inception,
      policyEndDate: expiry,
      isInspectionRequired: path.breakIn,
    });
  }

  /**
   * Prices the risk, then creates the ITGI proposal. The vendor identifiers
   * needed to bind payment (uniqueQuoteId / orderNo / traceNo) are returned in
   * `contractDetails` so issuePolicy can recover them.
   */
  async getFullQuote(
    req: MotorFullQuoteRequest,
    ctx: ProviderContext,
  ): Promise<CanonicalQuoteResult> {
    const { codes, path, idv, premiumBody, inception, expiry } = await this.priceVehicle(req, ctx);

    const quote = normalizeQuote(premiumBody, {
      requestId: ctx.requestId,
      quoteNo: req.quoteId,
      policyType: req.selectedPolicy,
      vehicleCategory: req.vehicleType,
      idvValue: idv.idv,
      minIdv: idv.minIdv,
      maxIdv: idv.maxIdv,
      hasAddons: hasElectedAddons(req),
      policyStartDate: inception,
      policyEndDate: expiry,
      isInspectionRequired: path.breakIn,
    });

    const iurn = req.kycRefId ?? req.ckyc;
    if (!iurn) {
      throw new AppError(
        400,
        "ITGI requires a completed CKYC (IURN) before a proposal",
        "KYC_REQUIRED",
      );
    }

    const reg = splitRegistrationNumber(req.registrationNumber ?? "");
    if (!reg) {
      throw new AppError(
        400,
        `ITGI could not parse the registration number "${req.registrationNumber ?? ""}"`,
        "VALIDATION_FAILED",
      );
    }

    const uniqueQuoteId = makeUniqueQuoteId(ctx.requestId);
    const coverages = buildCoverageItems(req, path).map((c) => ({
      code: c.coverageId,
      sumInsured: c.sumInsured,
      number: c.number,
    }));

    const proposalBody = await this.soap(
      ITGI_ENDPOINTS.proposal(this.config),
      buildProposalPayload(
        {
          uniqueQuoteId,
          iurn,
          product: itgiContractType(req.vehicleType),
          inceptionDate: toItgiDateTime(inception),
          expiryDate: toItgiDateTime(expiry, "23:59:59"),
          createdDate: toItgiDate(new Date().toISOString().slice(0, 10)),
          grossPremium: quote.netPremium,
          netPremiumPayable: quote.grossPremium,
          serviceTax: quote.serviceTaxAmount,
          odSumDisLoad: quote.basicOdPremium,
          tpSumDisLoad: quote.thirdPartyPremium,
          totalSumInsured: quote.idvValue,
          odDiscountLoading: req.odDiscountPercent ?? 0,
          odDiscountAmt: quote.discounts.ownDamageDiscount ?? 0,
          breakInofMorethan90days: path.breakInMoreThan90Days,
          zCover: path.zcover,
          policyType: path.policyType,
          nominee: req.nomineeName,
          nomineeRelationship: req.nomineeRelation,
          previousPolicyNo: req.previousPolicyNumber,
          previousPolicyStartdate: req.previousPolicyStartDate
            ? toItgiDate(req.previousPolicyStartDate)
            : undefined,
          previousPolicyEnddate: req.previousPolicyExpiryDate
            ? toItgiDate(req.previousPolicyExpiryDate)
            : undefined,
          previousPolicyInsurer: codes.previousInsurerCode ?? req.previousInsurerName,
          // Single-year OD renewals must carry the running package policy.
          tpPolicyNo: path.requiresTpPolicyDetails ? req.previousTpPolicyNumber : undefined,
          tpInceptionDate:
            path.requiresTpPolicyDetails && req.previousTpStartDate
              ? toItgiDate(req.previousTpStartDate)
              : undefined,
          tpExpiryDate:
            path.requiresTpPolicyDetails && req.previousTpExpiryDate
              ? toItgiDate(req.previousTpExpiryDate)
              : undefined,
          // Break-in pre-inspection evidence, when we have it.
          inspectionNo: req.inspectionReportNumber,
          inspectionDate: req.inspectionDate ? toItgiDate(req.inspectionDate) : undefined,
          inspectionStatus: req.inspectionReportNumber ? "APPROVED" : undefined,
          inspectionAgency: req.inspectionReportNumber ? "ITGI" : undefined,
          alternatePACover: req.paOwner ? undefined : "Y",
          newVehicleFlag: path.newVehicleFlag,
          contact: {
            firstName: req.proposer.firstName,
            lastName: req.proposer.lastName,
            dob: toItgiDate(req.proposer.dob),
            mailId: req.proposer.email,
            mobilePhone: req.proposer.mobile,
            addressLine1: req.address.addressLine1,
            addressLine2: req.address.addressLine2,
            city: req.address.city,
            state: req.address.state,
            pinCode: req.address.pincode,
            salutation: (req.proposer.title ?? "Mr").toUpperCase().slice(0, 3),
            sex: req.proposer.gender === "F" ? "F" : "M",
            married: "M",
            occupation: "OTHR",
            externalClientNo: req.quoteId,
            insuredPAN: req.proposer.panNumber,
            insuredAadhar: req.proposer.aadharNumber,
          },
          vehicle: {
            make: codes.makeCode,
            engineNumber: req.vehicle.engineNumber,
            chassisNumber: req.vehicle.chassisNumber,
            registrationDate: toItgiDate(req.registrationDate),
            manufacturingYear: new Date(req.registrationDate).getFullYear(),
            rtoCity: codes.rtoCity,
            engineCapacity: codes.engineCC ?? req.engineCC,
            seatingCapacity: codes.seatingCapacity ?? req.seatingCapacity,
            reg,
          },
          coverages,
        },
        this.partner,
      ),
      ITGI_NS.partner,
      ctx.requestId,
    );

    const proposal = parseProposalResponse(proposalBody);

    return {
      ...quote,
      quoteNo: req.quoteId,
      transactionId: uniqueQuoteId,
      contractDetails: {
        uniqueQuoteId,
        orderNo: proposal.orderNo,
        traceNo: proposal.traceNo,
        amountPayable: proposal.amountPayable,
        contractType: itgiContractType(req.vehicleType),
      },
    };
  }

  /** Binds the collected payment to the prior proposal → real policy number. */
  async issuePolicy(
    req: PolicyIssuanceRequest,
    ctx: ProviderContext,
  ): Promise<PolicyIssuanceResult> {
    // clientId carries our orderNo and quoteNo the traceNo (see getFullQuote's
    // contractDetails) — the two ids ITGI needs to match the payment.
    const body = await this.soap(
      ITGI_ENDPOINTS.payment(this.config),
      buildPaymentPayload(
        {
          orderNumber: req.clientId,
          traceNumber: req.quoteNo,
          amount: req.receipt.amount,
          authorizationCode: req.receipt.tranRefNo,
          authorizationStatus: req.receipt.uniqueTranKey,
          authorizationDecision: "Y",
        },
        this.config.partnerCode,
      ),
      ITGI_NS.partner,
      ctx.requestId,
    );

    const result = parsePaymentResponse(body);
    return {
      providerSlug: ITGI_SLUG,
      insurerName: ITGI_DISPLAY_NAME,
      // A break-in is accepted but only issued once ITGI's agency approves.
      status: result.isBreakInPending
        ? "INSPECTION_PENDING"
        : result.success
          ? "ISSUED"
          : "REJECTED",
      policyNumber: result.policyNumber || undefined,
      quoteNo: req.quoteNo,
      clientId: req.clientId,
      message: result.statusMessage,
      _rawResponse: body,
    };
  }

  async getPolicyStatus(
    req: PolicyStatusRequest,
    ctx: ProviderContext,
  ): Promise<PolicyStatusResult> {
    const body = await this.soap(
      ITGI_ENDPOINTS.policyStatus(this.config),
      buildStatusPayload(
        { uniqueQuoteId: req.transactionId, contractType: "PCP" },
        this.config.partnerCode,
      ),
      ITGI_NS.partner,
      ctx.requestId,
    );

    const result = parseStatusResponse(body);
    return {
      policyNumber: result.policyNumber || undefined,
      policyReferenceId: req.transactionId,
      status: result.isPaid && result.policyNumber ? "ISSUED" : "IN_PROGRESS",
      message: result.status,
      _rawResponse: body,
    };
  }

  /**
   * ITGI returns a download LINK rather than PDF bytes, and the canonical
   * contract carries base64. The link is surfaced via `status` so the caller can
   * fetch it; `coiBase64` stays empty until we fetch and encode the document.
   */
  async getCertificate(transactionId: string, ctx: ProviderContext): Promise<CertificateResult> {
    const result = await itgiDownloadPolicy(
      this.config,
      { policyNumber: transactionId, contractType: "PCP" },
      this.transport,
      ctx.requestId,
    );
    return { coiBase64: "", status: result.url ?? result.status, _rawResponse: result };
  }

  /**
   * CKYC: search for an existing record. An `OTPPending` result means CERSAI has
   * sent a consent OTP — the caller collects it and calls back through
   * initiateOvd/validate. The IURN is what the proposal ultimately needs.
   */
  async completeCkyc(req: CkycRequest, ctx: ProviderContext): Promise<KycResult> {
    const idType = req.panNumber ? "PAN" : req.ckycNumber ? "CKYC IDENTIFIER" : "AADHAR CARD NUMBER";
    const idNumber = req.panNumber ?? req.ckycNumber ?? req.aadhaarNumber ?? "";
    const [firstName, ...rest] = (req.fullName ?? "").trim().split(/\s+/);

    const result = await itgiKycFetch(
      this.config,
      {
        clientType: "IND",
        firstName: firstName || (req.nameAsPerAadhaar ?? ""),
        lastName: rest.join(" ") || undefined,
        dateofBirth: toCkycDate(req.dob),
        gender: req.gender === "F" ? "F" : req.gender === "M" ? "M" : undefined,
        idType,
        idNumber,
        mobileNumber: req.mobile,
      },
      this.transport,
      ctx.requestId,
    );

    return {
      isKycSuccess: result.success,
      kycId: result.iurn,
      ckycRefId: result.iurn,
      ckycNumber: result.iurn,
      displayMessage: result.message ?? result.status,
      // OTPPending means the customer must approve the CERSAI download.
      requiresRedirect: result.requiresOtp,
      _rawResponse: result,
    };
  }

  /**
   * Creates a KYC record from uploaded documents (the vendor's /kyc/create).
   * Also doubles as the OTP-validation entry point when an IURN is already
   * pending: passing the OTP through `proposalId` validates it.
   */
  async initiateOvd(
    req: OvdRequest,
    files: OvdFile[],
    ctx: ProviderContext,
  ): Promise<OvdResult> {
    // An IURN + OTP means we are completing a pending CERSAI consent rather than
    // creating a new record. The OTP rides in on `proposalId` (the only
    // free-form correlation field the canonical OVD request carries).
    if (req.proposalId) {
      const otp = await itgiKycValidateOtp(
        this.config,
        { itgiUniqueReferenceId: req.transactionId, otp: req.proposalId },
        this.transport,
        ctx.requestId,
      );
      return {
        isKycSuccess: otp.validated,
        displayMessage: otp.status,
        kycId: req.transactionId,
        proposalId: req.transactionId,
        _rawResponse: otp,
      };
    }

    const documents: ItgiKycDocument[] = files.map((f, i) => ({
      idType: i === 0 ? "IDENTITY_PROOF" : "ADDRESS_PROOF",
      idName: i === 0 ? req.proofOfIdentityType : req.proofOfAddressType,
      idNumber: "",
      fileName: f.originalName || `doc-${i}`,
      fileExtension: (f.originalName?.split(".").pop() ??
        "jpeg") as ItgiKycDocument["fileExtension"],
      fileBase64: f.buffer.toString("base64"),
    }));

    const result = await itgiKycCreate(
      this.config,
      { clientType: "IND", kycDocuments: documents } as unknown as Parameters<
        typeof itgiKycCreate
      >[1],
      this.transport,
      ctx.requestId,
    );

    return {
      isKycSuccess: result.success,
      displayMessage: result.message ?? result.status,
      kycId: result.iurn,
      proposalId: result.iurn,
      _rawResponse: result,
    };
  }
}
