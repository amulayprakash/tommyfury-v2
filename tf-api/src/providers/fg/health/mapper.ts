import { XMLBuilder } from "fast-xml-parser";
import type {
  HealthQuoteRequest,
  HealthFullQuoteRequest,
  HealthMember,
} from "@/contracts/health/health-quote-request.ts";
import type { HealthIssuanceRequest } from "@/contracts/health/health-policy.ts";
import type { MemberRelation } from "@/contracts/health/health-enums.ts";
import { toFgDate } from "../mapper.ts";
import {
  getFgHealthProduct,
  RELATION_FG_CODE,
  SALUTATION_BY_GENDER,
  type FgHealthProductDef,
} from "./config.ts";

// ─── SOAP envelope (shared BO/Service.svc gateway) ────────────────────────────
// All FG health products ride one SOAP service. Quote/issuance use `CreatePolicy`
// (METHOD switches ENQ vs CRT); the proposal/underwriting validation step uses
// `HealthPreCRTValidate`. The Product discriminator selects the rater.

export const HEALTH_SOAP_METHODS = {
  createPolicy: "CreatePolicy",
  preCrtValidate: "HealthPreCRTValidate",
} as const;

export const HEALTH_SOAP_ACTIONS = {
  createPolicy: "http://tempuri.org/IService/CreatePolicy",
  preCrtValidate: "http://tempuri.org/IService/HealthPreCRTValidate",
} as const;

export type FgHealthSoapMethod = (typeof HEALTH_SOAP_METHODS)[keyof typeof HEALTH_SOAP_METHODS];

const xmlBuilder = new XMLBuilder({ ignoreAttributes: true, suppressEmptyNode: false });

/** Wraps the Root payload object as XML inside FG's health SOAP envelope. */
export function buildHealthSoapEnvelope(
  method: FgHealthSoapMethod,
  soapProduct: string,
  root: Record<string, unknown>,
): string {
  const rootXml = xmlBuilder.build({ Root: root });
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">` +
    `<soapenv:Header/><soapenv:Body><tem:${method}>` +
    `<tem:Product>${soapProduct}</tem:Product>` +
    `<tem:XML><![CDATA[${rootXml}]]></tem:XML>` +
    `</tem:${method}></soapenv:Body></soapenv:Envelope>`
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Vendor attribution pulled from FgConfig (kept out of the request contract). */
export interface FgHealthPayloadMeta {
  vendorCode: string;
  agentCode: string;
  branchCode: string;
}

/** Optional master-backed code overrides (else built-in defaults are used). */
export interface FgHealthResolvedCodes {
  /** canonical relation → FG code overrides. */
  relation?: Partial<Record<MemberRelation, string>>;
  /** canonical occupation → FG code overrides. */
  occupation?: Record<string, string>;
  /** PA cover code → cover name. */
  paCoverNames?: Record<string, string>;
}

export interface FgHealthBuildResult {
  method: FgHealthSoapMethod;
  soapAction: string;
  soapProduct: string;
  payload: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addYearsIso(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const end = new Date(Date.UTC((y ?? 1970) + years, (m ?? 1) - 1, d ?? 1));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

function policyDates(startIso: string | undefined, years: number): { start: string; end: string } {
  const start = startIso ?? new Date().toISOString().slice(0, 10);
  return { start: toFgDate(start), end: toFgDate(addYearsIso(start, years)) };
}

const yn = (v: boolean | undefined): string => (v ? "Y" : "N");

function relCode(rel: MemberRelation, codes: FgHealthResolvedCodes): string {
  return codes.relation?.[rel] ?? RELATION_FG_CODE[rel] ?? "OTHR";
}

function occCode(code: string | undefined, codes: FgHealthResolvedCodes): string {
  if (!code) return "OTHR";
  return codes.occupation?.[code] ?? code;
}

const EMPTY_ADDRESS = {
  AddrLine1: "",
  AddrLine2: "",
  AddrLine3: "",
  Landmark: "",
  Pincode: "",
  City: "",
  State: "",
  Country: "IND",
  AddressType: "R",
  HomeTelNo: "",
  OfficeTelNo: "",
  FAXNO: "",
  MobileNo: "",
  EmailAddr: "",
};

const EMPTY_RECEIPT = {
  UniqueTranKey: "",
  CheckType: "",
  BSBCode: "",
  TransactionDate: "",
  ReceiptType: "IVR",
  Amount: "",
  TCSAmount: "",
  TranRefNo: "",
  TranRefNoDate: "",
};

interface ClientOpts {
  salutation: string;
  firstName: string;
  lastName: string;
  dob: string; // FG DD/MM/YYYY
  gender: string;
  occupation: string;
  maritalStatus?: string;
  pan?: string;
  aadhar?: string;
  ckyc?: string;
  ckycRef?: string;
  pincode?: string;
  city?: string;
  state?: string;
  addressLine1?: string;
  addressLine2?: string;
  mobile?: string;
  email?: string;
  /** DIY disability declaration (client level). */
  disability?: { has: boolean; udidNumber?: string; percent?: number };
}

function buildClient(opts: ClientOpts, def: FgHealthProductDef): Record<string, unknown> {
  const address = {
    ...EMPTY_ADDRESS,
    AddrLine1: opts.addressLine1 ?? "",
    AddrLine2: opts.addressLine2 ?? "",
    Pincode: opts.pincode ?? "",
    City: opts.city ?? "",
    State: opts.state ?? "",
    Country: "IND",
    AddressType: "R",
    MobileNo: opts.mobile ?? "",
    EmailAddr: opts.email ?? "",
  };
  const client: Record<string, unknown> = {
    ClientCategory: "",
    ClientType: "I",
    CreationType: "C",
    Salutation: opts.salutation,
    FirstName: opts.firstName,
    LastName: opts.lastName,
    DOB: opts.dob,
    Gender: opts.gender,
    MaritalStatus: opts.maritalStatus ?? "S",
    Occupation: opts.occupation,
    PANNo: opts.pan ?? "",
    GSTIN: "",
    AadharNo: opts.aadhar ?? "",
    CKYCNo: opts.ckyc ?? "",
    CKYCRefNo: opts.ckycRef ?? "",
    EIANo: "",
  };
  // DIY carries disability declaration on the Client block.
  if (def.features.disability) {
    client.DarpanID = "";
    client.HasDisability = opts.disability?.has ? "True" : "False";
    client.DisabilityRemarks = "";
    client.UDIDNumber = opts.disability?.udidNumber ?? "";
    client.PercentageOfDisability = opts.disability?.percent != null ? String(opts.disability.percent) : "";
  }
  client.Address1 = address;
  client.Address2 = { ...address, AddressType: "P" };
  client.VIPFlag = "N";
  client.VIPCategory = "";
  return client;
}

// ─── Indemnity member ─────────────────────────────────────────────────────────

function buildIndemnityMember(
  member: HealthMember,
  index: number,
  def: FgHealthProductDef,
  codes: FgHealthResolvedCodes,
): Record<string, unknown> {
  const f = def.features;
  const coverType = member.coverType ?? def.defaultCoverType ?? "";
  const out: Record<string, unknown> = {
    MemberId: String(member.memberId ?? index + 1),
    AbhaNo: member.abhaNo ?? "",
    InsuredName: member.name,
    InsuredDob: toFgDate(member.dob),
    InsuredGender: member.gender,
    InsuredOccpn: occCode(member.occupationCode, codes),
  };
  if (f.coverType) out.CoverType = coverType;
  out.SumInsured = member.sumInsured != null ? String(member.sumInsured) : "";
  if (f.topUp) {
    out.Deductible = member.deductible != null ? String(member.deductible) : "";
    out.Plantype = member.planType ?? def.defaultCoverType ?? "";
  }
  out.DeductibleDiscount = "";
  out.Relation = relCode(member.relation, codes);
  out.NomineeName = member.nominee?.name ?? "";
  out.NomineeRelation = member.nominee ? relCode(member.nominee.relation, codes) : "";
  out.AnualIncome = member.annualIncome != null ? String(member.annualIncome) : "";
  out.Height = member.heightCm != null ? String(member.heightCm) : "";
  out.Weight = member.weightKg != null ? String(member.weightKg) : "";
  out.NomineeAge = member.nominee?.age != null ? String(member.nominee.age) : "";
  out.AppointeeName = member.nominee?.appointeeName ?? "";
  out.AptRelWithNominee = member.nominee?.appointeeRelation
    ? relCode(member.nominee.appointeeRelation, codes)
    : "";
  if (f.smoking) out.Smoking = yn(member.smoking);
  if (f.alcohol) out.Alcohol = yn(member.alcohol);
  if (f.tobacco) out.Tobacco = yn(member.tobacco);
  out.IsGoodHealth = yn(member.isGoodHealth ?? true);
  if (f.medicalLoading) out.MedicalLoading = member.medicalLoading != null ? String(member.medicalLoading) : "";
  if (f.existingAbsolute) {
    out.IsExistingAbsolutePolicy = "N";
    out.AdditionalInformation = "";
  }
  return out;
}

function buildIndemnityRisk(
  req: { policyTermYears: number; installments: string; isFgEmployee: boolean; coPay?: boolean; members: HealthMember[] },
  def: FgHealthProductDef,
  codes: FgHealthResolvedCodes,
): Record<string, unknown> {
  const risk: Record<string, unknown> = {
    eNach: "N",
    PolicyType: def.policyType,
    Duration: String(req.policyTermYears),
    Installments: req.installments,
    PaymentType: "CC",
    IsFgEmployee: yn(req.isFgEmployee),
  };
  if (def.features.coPay) risk.CoPay = yn(req.coPay);
  Object.assign(risk, {
    BranchReferenceID: "",
    FGBankBranchStaffID: "",
    BankStaffID: "",
    BankCustomerID: "",
    BancaChannel: "",
    PartnerRefNo: "",
    PayorID: "",
    PayerName: "",
    BeneficiaryDetails: {
      Member: req.members.map((m, i) => buildIndemnityMember(m, i, def, codes)),
    },
  });
  return risk;
}

// ─── PA (Personal Accident) risk ──────────────────────────────────────────────

function buildPaRisk(
  req: { members: HealthMember[]; paPlan?: string; paUnit?: number; coverageClass?: string },
  def: FgHealthProductDef,
  codes: FgHealthResolvedCodes,
): Record<string, unknown> {
  const insured = req.members.map((m) => {
    const [firstName = m.name, ...rest] = m.name.split(" ");
    const covers = (m.pa?.covers ?? []).map((c) => ({
      Cover: {
        CoverCode: c.coverCode,
        CoverName: codes.paCoverNames?.[c.coverCode] ?? "",
        SumInsured: c.sumInsured != null ? String(c.sumInsured) : "",
        Premium: "",
        CoverType: c.coverType ?? "M",
        Times: "*",
        Benefit: "*",
      },
    }));
    return {
      FirstName: firstName,
      LastName: rest.join(" "),
      NomineeName: m.nominee?.name ?? "",
      NomineesRelationshipWithInsured: m.nominee ? relCode(m.nominee.relation, codes) : "",
      Gender: m.gender === "F" ? "Female" : "Male",
      Birthdate: toFgDate(m.dob),
      AgeIndicater: "Y",
      Nationality: "IND",
      OccupationCode: occCode(m.occupationCode, codes),
      RelationshipWithApplicant: relCode(m.relation, codes),
      PreExistingDisease: "N",
      AnnualIncome: m.annualIncome != null ? String(m.annualIncome) : "",
      PrimaryCoverReq: "Y",
      Exclusion: "",
      CumulativeBonus: "",
      PrimaryCover: covers.length > 0 ? covers : "",
    };
  });
  return {
    Duration: "",
    Installments: "",
    PaymentType: "",
    Discount: "",
    CoverageClass: req.coverageClass ?? "Individual",
    CoverageClassCode: def.contractType, // PAL
    Plan: req.paPlan ?? "",
    Unit: req.paUnit != null ? String(req.paUnit) : "1",
    Claimfreeyears: "0",
    OccupationClass: req.members[0]?.pa?.occupationClass ?? "0",
    CumulativeBonusAmount: "",
    AlreadyPAPolicy: "",
    AdditionalRemarks: "",
    PendingRemarks: "",
    Insured: insured,
  };
}

// ─── PolicyHeader / Root assembly ─────────────────────────────────────────────

function policyHeader(
  def: FgHealthProductDef,
  meta: FgHealthPayloadMeta,
  method: "ENQ" | "CRT",
  dates: { start: string; end: string },
  opts: { quoteNo?: string; clientId?: string } = {},
): Record<string, unknown> {
  return {
    PolicyStartDate: dates.start,
    PolicyEndDate: dates.end,
    AgentCode: meta.agentCode,
    BranchCode: meta.branchCode,
    strPolicyQuoteNumber: opts.quoteNo ?? "",
    MajorClass: def.majorClass,
    ContractType: def.contractType,
    METHOD: method,
    PolicyIssueType: "I",
    PolicyNo: "",
    ClientID: opts.clientId ?? "",
    ReceiptNo: "",
  };
}

function rootBase(
  requestId: string,
  meta: FgHealthPayloadMeta,
): Record<string, unknown> {
  return {
    Uid: requestId,
    VendorCode: meta.vendorCode,
    VendorUserId: meta.vendorCode,
    SentToOutSourcePrint: "0",
    WinNo: "",
    ApplicationNo: "",
  };
}

/** Builds the Client block from the policy's "self" member when no proposer is supplied. */
function selfMemberClient(req: HealthQuoteRequest, def: FgHealthProductDef): Record<string, unknown> {
  const self = req.members.find((m) => m.relation === "self") ?? req.members[0]!;
  const [firstName = self.name, ...rest] = self.name.split(" ");
  return buildClient(
    {
      salutation: SALUTATION_BY_GENDER[self.gender],
      firstName,
      lastName: rest.join(" ") || firstName,
      dob: toFgDate(self.dob),
      gender: self.gender,
      occupation: self.occupationCode ?? "OTHR",
      pincode: req.pincode,
      city: req.city,
      state: req.state,
      disability: self.disability,
    },
    def,
  );
}

// ─── Builders (quote / proposal / issuance) ───────────────────────────────────

export function buildHealthQuotePayload(
  req: HealthQuoteRequest,
  codes: FgHealthResolvedCodes,
  meta: FgHealthPayloadMeta,
  requestId: string,
): FgHealthBuildResult {
  const def = getFgHealthProduct(req.product);
  const dates = policyDates(req.policyStartDate, req.policyTermYears);
  const payload: Record<string, unknown> = {
    ...rootBase(requestId, meta),
    PolicyHeader: policyHeader(def, meta, "ENQ", dates),
    POS_MISP: { Type: "", PanNo: "" },
    Client: selfMemberClient(req, def),
    Receipt: { ...EMPTY_RECEIPT },
    Risk: def.line === "pa" ? buildPaRisk(req, def, codes) : buildIndemnityRisk(req, def, codes),
  };
  return {
    method: HEALTH_SOAP_METHODS.createPolicy,
    soapAction: HEALTH_SOAP_ACTIONS.createPolicy,
    soapProduct: def.soapProduct,
    payload,
  };
}

/**
 * Builds the full proposal Root (Client + Risk) shared by the proposal-validation
 * and issuance steps — FG health re-submits the entire payload at issuance rather
 * than referencing a QuotationNo. `receipt` is empty for proposal, populated at
 * issuance.
 */
function buildFullProposalPayload(
  req: HealthFullQuoteRequest,
  codes: FgHealthResolvedCodes,
  meta: FgHealthPayloadMeta,
  requestId: string,
  receipt: Record<string, unknown>,
  clientId?: string,
): { def: FgHealthProductDef; payload: Record<string, unknown> } {
  const def = getFgHealthProduct(req.product);
  const dates = policyDates(req.policyStartDate, req.policyTermYears);
  const { proposer, address } = req;
  const client = buildClient(
    {
      salutation: proposer.title ? proposer.title.toUpperCase() : SALUTATION_BY_GENDER[proposer.gender ?? "M"],
      firstName: proposer.firstName,
      lastName: proposer.lastName,
      dob: toFgDate(proposer.dob),
      gender: proposer.gender ?? "M",
      occupation: req.members[0]?.occupationCode ?? "OTHR",
      maritalStatus: req.maritalStatus,
      pan: proposer.panNumber,
      aadhar: proposer.aadharNumber,
      ckyc: req.ckyc,
      ckycRef: req.kycRefId,
      pincode: address.pincode,
      city: address.city,
      state: address.state,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      mobile: proposer.mobile,
      email: proposer.email,
      disability: req.members.find((m) => m.relation === "self")?.disability,
    },
    def,
  );
  const payload: Record<string, unknown> = {
    ...rootBase(requestId, meta),
    PolicyHeader: policyHeader(def, meta, "CRT", dates, { quoteNo: req.quoteId, clientId }),
    POS_MISP: { Type: "", PanNo: "" },
    Client: client,
    Receipt: receipt,
    Risk: def.line === "pa" ? buildPaRisk(req, def, codes) : buildIndemnityRisk(req, def, codes),
  };
  return { def, payload };
}

export function buildHealthProposalPayload(
  req: HealthFullQuoteRequest,
  codes: FgHealthResolvedCodes,
  meta: FgHealthPayloadMeta,
  requestId: string,
): FgHealthBuildResult {
  const { def, payload } = buildFullProposalPayload(req, codes, meta, requestId, { ...EMPTY_RECEIPT });
  return {
    method: HEALTH_SOAP_METHODS.preCrtValidate,
    soapAction: HEALTH_SOAP_ACTIONS.preCrtValidate,
    soapProduct: def.soapProduct,
    payload,
  };
}

export function buildHealthIssuancePayload(
  req: HealthIssuanceRequest,
  codes: FgHealthResolvedCodes,
  meta: FgHealthPayloadMeta,
  requestId: string,
): FgHealthBuildResult {
  const r = req.receipt;
  const receipt = {
    UniqueTranKey: r.uniqueTranKey,
    CheckType: r.checkType ?? "",
    BSBCode: r.bsbCode ?? "",
    TransactionDate: r.transactionDate,
    ReceiptType: r.receiptType,
    Amount: String(r.amount),
    TCSAmount: r.tcsAmount ?? "",
    TranRefNo: r.tranRefNo,
    TranRefNoDate: r.tranRefNoDate,
    PGType: r.pgType,
  };
  const { def, payload } = buildFullProposalPayload(req, codes, meta, requestId, receipt, req.clientId);
  return {
    method: HEALTH_SOAP_METHODS.createPolicy,
    soapAction: HEALTH_SOAP_ACTIONS.createPolicy,
    soapProduct: def.soapProduct,
    payload,
  };
}
