import { describe, it, expect } from "vitest";
import {
  buildHealthQuotePayload,
  buildHealthIssuancePayload,
  buildHealthSoapEnvelope,
} from "../mapper.ts";
import { HealthQuoteRequestSchema } from "@/contracts/health/health-quote-request.ts";
import { HealthIssuanceRequestSchema } from "@/contracts/health/health-policy.ts";

const meta = { vendorCode: "webagg", agentCode: "60000272", branchCode: "10" };
const codes = {};

const absoluteQuote = HealthQuoteRequestSchema.parse({
  product: "healthAbsolute",
  policyTermYears: 1,
  policyStartDate: "2025-01-01",
  members: [
    {
      relation: "self",
      name: "shiv dayal kumawat",
      dob: "1993-08-16",
      gender: "M",
      occupationCode: "SVCM",
      sumInsured: 500000,
      heightCm: 170,
      weightKg: 70,
      tobacco: false,
      nominee: { name: "Papa PAPA", relation: "father", age: 44 },
    },
  ],
});

describe("buildHealthQuotePayload — indemnity (Health Absolute)", () => {
  const built = buildHealthQuotePayload(absoluteQuote, codes, meta, "uid-1");
  const header = built.payload.PolicyHeader as Record<string, unknown>;
  const risk = built.payload.Risk as Record<string, unknown>;
  const member = (risk.BeneficiaryDetails as { Member: Record<string, unknown>[] }).Member[0]!;

  it("targets CreatePolicy/ENQ with the product's class codes", () => {
    expect(built.method).toBe("CreatePolicy");
    expect(built.soapProduct).toBe("HealthAbsolute");
    expect(header.MajorClass).toBe("FHA");
    expect(header.ContractType).toBe("FHA");
    expect(header.METHOD).toBe("ENQ");
  });

  it("sets PolicyType + Duration on Risk", () => {
    expect(risk.PolicyType).toBe("HAI");
    expect(risk.Duration).toBe("1");
  });

  it("builds the member with default cover type, FG relation code, and tobacco flag", () => {
    expect(member.CoverType).toBe("Classic");
    expect(member.SumInsured).toBe("500000");
    expect(member.Relation).toBe("SELF");
    expect(member.NomineeRelation).toBe("FATH");
    expect(member.Tobacco).toBe("N");
    expect(member.IsGoodHealth).toBe("Y");
  });

  it("formats dates as FG DD/MM/YYYY", () => {
    expect(header.PolicyStartDate).toBe("01/01/2025");
    expect(header.PolicyEndDate).toBe("31/12/2025");
    expect(member.InsuredDob).toBe("16/08/1993");
  });
});

describe("buildHealthQuotePayload — Personal Accident", () => {
  const paQuote = HealthQuoteRequestSchema.parse({
    product: "personalAccident",
    paPlan: "FI1",
    coverageClass: "Individual",
    members: [
      {
        relation: "self",
        name: "John Doe",
        dob: "2001-01-03",
        gender: "M",
        occupationCode: "ACCT",
        annualIncome: 500000,
        pa: { occupationClass: "1", covers: [{ coverCode: "AD", coverType: "M" }] },
      },
    ],
  });
  const built = buildHealthQuotePayload(paQuote, codes, meta, "uid-pa");
  const header = built.payload.PolicyHeader as Record<string, unknown>;
  const risk = built.payload.Risk as Record<string, unknown>;

  it("uses the PA class codes + benefit-cover structure", () => {
    expect(built.soapProduct).toBe("PA");
    expect(header.MajorClass).toBe("PAC");
    expect(header.ContractType).toBe("PAL");
    expect(risk.CoverageClassCode).toBe("PAL");
    expect(risk.Plan).toBe("FI1");
    const insured = (risk.Insured as Record<string, unknown>[])[0]!;
    expect(insured.OccupationCode).toBe("ACCT");
    const cover = (insured.PrimaryCover as { Cover: Record<string, unknown> }[])[0]!.Cover;
    expect(cover.CoverCode).toBe("AD");
  });
});

describe("buildHealthIssuancePayload", () => {
  const issuance = HealthIssuanceRequestSchema.parse({
    ...absoluteQuote,
    quoteId: "Q-123",
    proposer: {
      firstName: "Shiv",
      lastName: "Kumawat",
      email: "shiv@example.com",
      mobile: "9829876493",
      dob: "1993-08-16",
      gender: "M",
    },
    address: {
      addressLine1: "42 narmda apartmnt",
      pincode: "626138",
      city: "Virudhunagar",
      state: "Tamil Nadu",
    },
    receipt: {
      uniqueTranKey: "FGABS123",
      transactionDate: "01/01/2025",
      amount: 10095,
      tranRefNo: "TR123",
      tranRefNoDate: "01/01/2025",
      pgType: "PAYU",
    },
  });
  const built = buildHealthIssuancePayload(issuance, codes, meta, "uid-iss");
  const receipt = built.payload.Receipt as Record<string, unknown>;

  it("re-submits the full payload (Client + Risk) plus the populated Receipt", () => {
    expect(built.method).toBe("CreatePolicy");
    expect((built.payload.PolicyHeader as Record<string, unknown>).METHOD).toBe("CRT");
    expect(built.payload.Client).toBeDefined();
    expect(built.payload.Risk).toBeDefined();
    expect(receipt.Amount).toBe("10095");
    expect(receipt.TranRefNo).toBe("TR123");
    expect(receipt.PGType).toBe("PAYU");
  });
});

describe("buildHealthSoapEnvelope", () => {
  it("wraps the Root in the product-tagged CreatePolicy envelope", () => {
    const xml = buildHealthSoapEnvelope("CreatePolicy", "HealthAbsolute", { Uid: "x" });
    expect(xml).toContain("<tem:Product>HealthAbsolute</tem:Product>");
    expect(xml).toContain("<![CDATA[<Root>");
    expect(xml).toContain("<tem:CreatePolicy>");
  });
});
