import { describe, it, expect } from "vitest";
import newProposal from "../fixtures/collection/new-proposal.json" with { type: "json" };
import newIdv from "../fixtures/collection/new-idv.json" with { type: "json" };
import {
  buildGetCalculateIDV,
  buildCalculatePremium,
  buildCreateProposal,
  buildGetProposalDocument,
  buildGetPolicyDocument,
  buildSubmitPaymentDetails,
} from "../mapper/index.ts";
import { buildCustomerDetails } from "../mapper/customer.ts";
import type { HdfcRequestShape } from "../types.ts";

function shape(overrides: Partial<HdfcRequestShape> = {}): HdfcRequestShape {
  return {
    transactionId: "TXN-1",
    businessType: "New Vehicle",
    isElectric: false,
    vehicle: {
      modelCode: "38908",
      rtoCode: "10406",
      registrationNo: "MH01QQ7878",
      registrationDate: "2024-03-17",
      manufactureYear: "2024",
      idv: 949411,
    },
    policy: { startDate: "2024-03-19", proposalDate: "2024-03-18", tenure: 1, policyType: "OD Plus TP" },
    previousPolicy: { ncbPercentage: 0, claim: false },
    addons: {} as HdfcRequestShape["addons"],
    ev: {},
    ...overrides,
  };
}

describe("buildGetCalculateIDV", () => {
  it("emits exactly the collection's IDV_DETAILS keys", () => {
    const out = buildGetCalculateIDV(shape());
    expect(Object.keys(out)).toEqual(Object.keys(newIdv));
    expect(Object.keys(out.IDV_DETAILS as object)).toEqual(Object.keys(newIdv.IDV_DETAILS));
  });

  it("always sends Registration_No 'New', even for a registered vehicle", () => {
    // IDV is computed from model + RTO + dates, not the plate. Sending a real
    // number made HDFC's schema demand registrationNumberSection* fields.
    const out = buildGetCalculateIDV(shape()) as { IDV_DETAILS: Record<string, unknown> };
    expect(out.IDV_DETAILS.Registration_No).toBe("New");
  });

  it("never emits registrationNumberSection fields", () => {
    const json = JSON.stringify(buildGetCalculateIDV(shape()));
    expect(json).not.toContain("registrationNumberSection");
  });

  it("carries the transaction id", () => {
    expect((buildGetCalculateIDV(shape()) as { TransactionID: string }).TransactionID).toBe("TXN-1");
  });
});

describe("buildCalculatePremium", () => {
  it("emits the three top-level blocks in the collection's order", () => {
    expect(Object.keys(buildCalculatePremium(shape()))).toEqual([
      "TransactionID",
      "Policy_Details",
      "Req_PvtCar",
    ]);
  });
});

describe("buildCreateProposal", () => {
  it("emits the four top-level blocks in the collection's order", () => {
    expect(Object.keys(buildCreateProposal(shape()))).toEqual(
      Object.keys(newProposal),
    );
  });

  it("sends the real registration number in DASH format", () => {
    const out = buildCreateProposal(shape()) as { Policy_Details: Record<string, unknown> };
    expect(out.Policy_Details.Registration_No).toBe("MH-01-QQ-7878");
  });

  it("sends 'New' when the vehicle has no plate yet", () => {
    const out = buildCreateProposal(
      shape({ vehicle: { ...shape().vehicle, registrationNo: undefined } }),
    ) as { Policy_Details: Record<string, unknown> };
    expect(out.Policy_Details.Registration_No).toBe("New");
  });

  it("still emits no registrationNumberSection fields", () => {
    expect(JSON.stringify(buildCreateProposal(shape()))).not.toContain("registrationNumberSection");
  });
});

describe("buildCustomerDetails", () => {
  it("maps the Pehchaan id into Customer_Pehchaan_id", () => {
    const out = buildCustomerDetails({ pehchaanId: "KYC-99" });
    expect(out.Customer_Pehchaan_id).toBe("KYC-99");
  });

  it("emits an empty string, not undefined, for absent optional fields", () => {
    const out = buildCustomerDetails({});
    expect(out.Customer_FirstName).toBe("");
    expect(out.Customer_Pehchaan_id).toBe("");
  });

  it("mirrors permanent address into the mailing address by default", () => {
    const out = buildCustomerDetails({ permAddress1: "12 Main St", permPinCode: "400001" });
    expect(out.Customer_Mailing_Address1).toBe("12 Main St");
    expect(out.Customer_Mailing_PinCode).toBe("400001");
  });

  it("appends a trailing null BusinessType_Mandatary only when asked", () => {
    expect("BusinessType_Mandatary" in buildCustomerDetails({})).toBe(false);
    expect(buildCustomerDetails({}, { trailingBusinessType: true }).BusinessType_Mandatary).toBeNull();
  });
});

describe("document and payment builders", () => {
  it("builds the proposal-document request", () => {
    expect(buildGetProposalDocument(shape({ proposalNumber: "PR-1" }))).toEqual({
      TransactionID: "TXN-1",
      Req_Policy_Document: { Proposal_Number: "PR-1" },
    });
  });

  it("builds the policy-document request", () => {
    expect(buildGetPolicyDocument(shape({ policyNumber: "POL-1" }))).toEqual({
      TransactionID: "TXN-1",
      Req_Policy_Document: { Policy_Number: "POL-1" },
    });
  });

  it("builds the payment request with the amount as a string", () => {
    const out = buildSubmitPaymentDetails(
      shape({
        proposalNumber: "PR-1",
        payment: { amount: 43150, instrumentNumber: "PG-77", paymentDate: "2026-08-07" },
      }),
    ) as { Payment_Details: Record<string, unknown>; Proposal_no: string };
    expect(out.Proposal_no).toBe("PR-1");
    expect(out.Payment_Details.PAYMENT_AMOUNT).toBe("43150");
    expect(out.Payment_Details.INSTRUMENT_NUMBER).toBe("PG-77");
    expect(out.Payment_Details.PAYMENT_DATE).toBe("07/08/2026");
  });

  it("falls back to the transaction id when the PG gave no instrument number", () => {
    const out = buildSubmitPaymentDetails(
      shape({ proposalNumber: "PR-1", payment: { amount: 100 } }),
    ) as { Payment_Details: Record<string, unknown> };
    expect(out.Payment_Details.INSTRUMENT_NUMBER).toBe("TXN-1");
  });
});
