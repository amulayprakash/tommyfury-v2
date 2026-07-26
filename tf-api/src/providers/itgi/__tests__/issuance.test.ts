import { describe, it, expect, vi } from "vitest";
import { buildProposalPayload, parseProposalResponse } from "../proposal.ts";
import { buildPaymentPayload, parsePaymentResponse } from "../payment.ts";
import { buildStatusPayload, parseStatusResponse } from "../policy-status.ts";
import { itgiDownloadPolicy } from "../certificate.ts";
import {
  itgiKycFetch,
  itgiKycValidateOtp,
  itgiKycCreate,
  mapKycStatus,
  toCkycDate,
} from "../ckyc.ts";
import type { ItgiTransport } from "../http.ts";
import type { ItgiConfig } from "../config.ts";

const cfg: ItgiConfig = {
  soapBaseUrl: "https://s/services",
  restBaseUrl: "https://s/partner-services",
  partnerCode: "ITGIMOT999",
  partnerBranch: "TF",
  partnerSubBranch: "TF",
  responseUrl: "https://x/y",
  downloadUser: "u",
  downloadPassword: "p",
};

const stubJson = (response: unknown): ItgiTransport => ({
  soap: vi.fn(),
  json: vi.fn().mockResolvedValue(response),
});

const partner = {
  partnerCode: "ITGIMOT999",
  partnerBranch: "TF",
  partnerSubBranch: "TF",
  responseUrl: "https://x/y",
};

const proposalInput = {
  uniqueQuoteId: "TFQ0000000001",
  iurn: "AOF3XL0PLU1MEH",
  product: "PCP" as const,
  inceptionDate: "02/26/2026 00:00:00",
  expiryDate: "02/25/2027 23:59:59",
  grossPremium: 10604,
  netPremiumPayable: 12513,
  serviceTax: 1908,
  odSumDisLoad: 7907,
  tpSumDisLoad: 2697,
  totalSumInsured: 105665,
  odDiscountLoading: -20,
  odDiscountAmt: -1976,
  breakInofMorethan90days: "N" as const,
  zCover: "CO" as const,
  policyType: "CP" as const,
  nominee: "Asha",
  nomineeRelationship: "Spouse",
  contact: {
    firstName: "Tom",
    lastName: "Gage",
    dob: "01/01/1992",
    mailId: "a@b.c",
    mobilePhone: "9876543210",
    addressLine1: "HNO 1",
    addressLine2: "Street",
    city: "DELHI",
    state: "DL",
    pinCode: "110001",
    salutation: "MR",
    sex: "M",
    married: "M",
    occupation: "OTHR",
    externalClientNo: "C1",
  },
  vehicle: {
    make: "MRSFT",
    engineNumber: "EN123",
    chassisNumber: "CH123",
    registrationDate: "10/20/2023",
    manufacturingYear: 2023,
    rtoCity: "DELHI",
    engineCapacity: 1197,
    seatingCapacity: 5,
    reg: { p1: "DL", p2: "10", p3: "AH", p4: "4567" },
  },
  coverages: [{ code: "IDV Basic", sumInsured: 105665, odPremium: 6075, tpPremium: 670 }],
};

describe("itgi proposal", () => {
  it("carries the IURN, unique quote id and split registration number", () => {
    const xml = buildProposalPayload(proposalInput, partner);
    expect(xml).toContain("<wrap:uniqueQuoteId>TFQ0000000001</wrap:uniqueQuoteId>");
    expect(xml).toContain("AOF3XL0PLU1MEH");
    expect(xml).toContain("<wrap:registrationNumber1>DL</wrap:registrationNumber1>");
    expect(xml).toContain("<wrap:registrationNumber4>4567</wrap:registrationNumber4>");
  });

  it("identifies the partner in both the partner block and the policy", () => {
    const xml = buildProposalPayload(proposalInput, partner);
    expect(xml).toContain("<wrap:partnerCode>ITGIMOT999</wrap:partnerCode>");
    expect(xml).toContain("<wrap:externalServiceConsumer>ITGIMOT999</wrap:externalServiceConsumer>");
  });

  it("includes the OD renewal's running TP policy when supplied", () => {
    const xml = buildProposalPayload(
      { ...proposalInput, policyType: "OD", tpPolicyNo: "TP123", tpInsurerName: "ACME" },
      partner,
    );
    expect(xml).toContain("<wrap:tpPolicyNo>TP123</wrap:tpPolicyNo>");
    expect(xml).toContain("<wrap:policyType>OD</wrap:policyType>");
  });

  it("includes break-in inspection evidence when supplied", () => {
    const xml = buildProposalPayload(
      {
        ...proposalInput,
        breakInofMorethan90days: "Y",
        inspectionNo: "INS-1",
        inspectionDate: "07/01/2026",
        inspectionStatus: "APPROVED",
        inspectionAgency: "ITGI",
      },
      partner,
    );
    expect(xml).toContain("<wrap:inspectionNo>INS-1</wrap:inspectionNo>");
    expect(xml).toContain("<wrap:inspectionStatus>APPROVED</wrap:inspectionStatus>");
    expect(xml).toContain("<wrap:breakInofMorethan90days>Y</wrap:breakInofMorethan90days>");
  });

  it("extracts orderNo and traceNo from the response", () => {
    const r = parseProposalResponse({
      validateProposalRequestResponse: {
        validateProposalRequestReturn: {
          amountPayable: "18318.79",
          orderNo: "000006AS5YSI",
          traceNo: "153852",
        },
      },
    });
    expect(r).toEqual({ orderNo: "000006AS5YSI", traceNo: "153852", amountPayable: 18319 });
  });

  it("throws when the proposal response carries an error", () => {
    expect(() =>
      parseProposalResponse({
        validateProposalRequestResponse: {
          validateProposalRequestReturn: { error: "Invalid make code" },
        },
      }),
    ).toThrow(/Invalid make code/);
  });
});

describe("itgi payment", () => {
  it("sends the order and trace numbers from the proposal", () => {
    const xml = buildPaymentPayload(
      {
        orderNumber: "000006AS5YSI",
        traceNumber: "153852",
        amount: 18318,
        authorizationCode: "833",
        authorizationStatus: "199",
      },
      "ITGIMOT999",
    );
    expect(xml).toContain("<util:orderNumber>000006AS5YSI</util:orderNumber>");
    expect(xml).toContain("<util:traceNumber>153852</util:traceNumber>");
    expect(xml).toContain("<util:authorizationDecision>Y</util:authorizationDecision>");
  });

  it("extracts the policy number and success sentinel", () => {
    const r = parsePaymentResponse({
      updatePaymentDetailsResponse: {
        updatePaymentDetailsReturn: {
          policyNumber: "M0003356",
          statusMessage: "SUCCESSFULLY_SUBMITTED_IN_P400",
          premiumPayable: "18318",
        },
      },
    });
    expect(r.policyNumber).toBe("M0003356");
    expect(r.success).toBe(true);
    expect(r.isBreakInPending).toBe(false);
  });

  it("treats a break-in acceptance as success but pending", () => {
    const r = parsePaymentResponse({
      updatePaymentDetailsResponse: {
        updatePaymentDetailsReturn: {
          policyNumber: "1522313725648",
          statusMessage: "PAYMENT_ACCEPTED_BREAK_IN",
        },
      },
    });
    expect(r.success).toBe(true);
    expect(r.isBreakInPending).toBe(true);
  });

  it("treats a declined transaction as failure", () => {
    const r = parsePaymentResponse({
      updatePaymentDetailsResponse: {
        updatePaymentDetailsReturn: { statusMessage: "TRANCTION_DECLINED" },
      },
    });
    expect(r.success).toBe(false);
  });
});

describe("itgi policy status", () => {
  it("is keyed by uniqueQuoteId", () => {
    const xml = buildStatusPayload(
      { uniqueQuoteId: "5120972487616", contractType: "PCP" },
      "ITGIMOT999",
    );
    expect(xml).toContain("<util:uniqueQuoteId>5120972487616</util:uniqueQuoteId>");
    expect(xml).toContain("<util:partnerCode>ITGIMOT999</util:partnerCode>");
  });

  it("maps authFlag Y to a paid, issued policy", () => {
    const r = parseStatusResponse({
      getPolicyStatusResponse: {
        getPolicyStatusReturn: {
          authFlag: "Y",
          policyNo: "MC897210",
          status: "SUCCESSFULLY_SUBMITTED_IN_P400",
          traceNo: "056129",
          amount: "17399.0000",
        },
      },
    });
    expect(r.policyNumber).toBe("MC897210");
    expect(r.isPaid).toBe(true);
    expect(r.amount).toBe(17399);
  });

  it("maps a blank authFlag to no payment attempted", () => {
    const r = parseStatusResponse({
      getPolicyStatusResponse: { getPolicyStatusReturn: { authFlag: "", policyNo: "" } },
    });
    expect(r.isPaid).toBe(false);
  });
});

describe("itgi certificate", () => {
  it("posts with basic auth and returns the download link", async () => {
    const transport = stubJson({
      policyDownloadLink: "https://x/p.pdf",
      statusMessage: "SUCCESS",
      error: null,
    });
    const r = await itgiDownloadPolicy(
      cfg,
      { policyNumber: "MC897781", contractType: "TWP" },
      transport,
      "req-1",
    );
    expect(r.url).toBe("https://x/p.pdf");
    expect(r.success).toBe(true);
    expect(transport.json).toHaveBeenCalledWith(
      expect.stringContaining("/policy/download"),
      expect.objectContaining({ policyDownloadNo: "MC897781" }),
      expect.objectContaining({ basicAuth: { user: "u", password: "p" } }),
    );
  });

  it("reports failure when no link is returned", async () => {
    const transport = stubJson({ policyDownloadLink: "", statusMessage: "SUCCESS" });
    const r = await itgiDownloadPolicy(
      cfg,
      { policyNumber: "X", contractType: "PCP" },
      transport,
      "req-1",
    );
    expect(r.success).toBe(false);
  });
});

describe("itgi ckyc", () => {
  it("converts ISO dates to the CKYC DD-MM-YYYY order", () => {
    expect(toCkycDate("1992-01-31")).toBe("31-01-1992");
  });

  it("returns the IURN when a record is found", async () => {
    const t = stubJson({
      status: 200,
      result: { status: "SUCCESS", itgiUniqueReferenceId: "AOF3XL0PLU1MEH" },
    });
    const r = await itgiKycFetch(
      cfg,
      {
        clientType: "IND",
        firstName: "Tom",
        lastName: "Gage",
        dateofBirth: "01-01-1992",
        idType: "PAN",
        idNumber: "TESPA7100P",
        mobileNumber: "9876543210",
      },
      t,
      "req-1",
    );
    expect(r.iurn).toBe("AOF3XL0PLU1MEH");
    expect(r.success).toBe(true);
  });

  it("surfaces OTPPending so the caller can prompt for the OTP", async () => {
    const t = stubJson({ status: 200, result: { status: "OTPPending", ckycRemarks: "consent sent" } });
    const r = await itgiKycFetch(
      cfg,
      {
        clientType: "IND",
        firstName: "T",
        dateofBirth: "01-01-1992",
        idType: "PAN",
        idNumber: "X",
        mobileNumber: "9",
      },
      t,
      "req-1",
    );
    expect(r.requiresOtp).toBe(true);
    expect(r.success).toBe(false);
  });

  it("validates an OTP", async () => {
    const t = stubJson({ status: 200, result: { status: "OTPValidation-Success" } });
    const r = await itgiKycValidateOtp(
      cfg,
      { itgiUniqueReferenceId: "VGFASCZUBI9CPA", otp: "123456" },
      t,
      "req-1",
    );
    expect(r.validated).toBe(true);
    expect(t.json).toHaveBeenCalledWith(
      expect.stringContaining("/kyc/fetch-validate-otp"),
      expect.objectContaining({
        validateOTPFlag: "Y",
        cersaiDownloadOTP: "123456",
        resendOTPFlag: "N",
      }),
      expect.anything(),
    );
  });

  it("resends an OTP without setting the validate flag", async () => {
    const t = stubJson({ status: 200, result: { status: "OTPReTriggered-Success" } });
    const r = await itgiKycValidateOtp(
      cfg,
      { itgiUniqueReferenceId: "V", resend: true },
      t,
      "req-1",
    );
    expect(r.resent).toBe(true);
    expect(t.json).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ validateOTPFlag: "N", resendOTPFlag: "Y", cersaiDownloadOTP: "" }),
      expect.anything(),
    );
  });

  it("treats an existing record on create as success", async () => {
    const t = stubJson({
      status: 200,
      result: {
        status: "EXISTING RECORD",
        itgiUniqueReferenceId: "X70QOPGSCU7IYK",
        recordCreated: "N",
      },
    });
    const r = await itgiKycCreate(cfg, { clientType: "IND", kycDocuments: [] } as never, t, "req-1");
    expect(r.iurn).toBe("X70QOPGSCU7IYK");
    expect(r.success).toBe(true);
  });

  it("reports a document-rule failure with a blank IURN", async () => {
    const t = stubJson({
      status: 200,
      result: {
        status: "Either of PAN or Form60 is mandatory",
        itgiUniqueReferenceId: "",
        recordCreated: "N",
      },
    });
    const r = await itgiKycCreate(cfg, { clientType: "IND", kycDocuments: [] } as never, t, "req-1");
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/PAN or Form60/i);
  });

  it("maps vendor statuses onto canonical kyc states", () => {
    expect(mapKycStatus("SUCCESS")).toBe("verified");
    expect(mapKycStatus("EXISTING RECORD")).toBe("verified");
    expect(mapKycStatus("OTPPending")).toBe("pending");
    expect(mapKycStatus("Either of PAN or Form60 is mandatory")).toBe("failed");
  });
});
