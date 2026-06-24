import { XMLBuilder } from "fast-xml-parser";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { PolicyIssuanceRequest } from "@/contracts/policy.ts";
import { FUEL_MAP, resolveContract } from "./config.ts";

/** Master codes resolved (DB or pass-through) before building a payload. */
export interface FgResolvedCodes {
  make: string; // FG Make label, e.g. "HONDA"
  modelCode: string; // FG ModelCode (PASIA_CODE), e.g. "HO0176"
  rtoCode: string; // FG RTOCode, e.g. "MH01"
  zone: string; // FG zone, "A" | "B"
  // Vehicle enrichment from the MMV master (used to build the payload).
  bodyType?: string;
  engineCC?: number;
  gvw?: number;
  seatingCapacity?: number;
  carryingCapacity?: number;
  /** FG VehicleClass code (commercial only), e.g. "A1"/"A3". */
  vehicleClass?: string;
  /** FG insurer ClientCode of the previous insurer (for standalone-OD PreviousTPInsDtls). */
  previousInsurerCode?: string;
}

/** Vendor attribution pulled from FgConfig (kept out of the request contract). */
export interface FgPayloadMeta {
  vendorCode: string;
  agentCode: string;
  branchCode: string;
}

// ─── Endpoints + SOAP envelope (XML gateway) ──────────────────────────────────
// FG's motor API is SOAP/XML on /MotorNB/1.0.0 (the JSON /MotorAPI endpoint is
// non-functional in UAT). The Root payload is XML-serialized inside the envelope.

export const endpoints = {
  getQuote: () => `/MotorNB/1.0.0/GetQuote`,
  createProposal: () => `/MotorNB/1.0.0/CreateProposal`,
  issueProposal: () => `/MotorNB/1.0.0/PolicyIssuance`,
};

const SOAP_METHODS = {
  getQuote: "GetQuote",
  createProposal: "CreateProposal",
  issueProposal: "PolicyIssuance_Vendors",
} as const;

export const SOAP_ACTIONS = {
  getQuote: "http://tempuri.org/IService/GetQuote",
  createProposal: "http://tempuri.org/IService/CreateProposal",
  issueProposal: "http://tempuri.org/IService/PolicyIssuance_Vendors",
} as const;

export type FgOperation = keyof typeof SOAP_METHODS;

const xmlBuilder = new XMLBuilder({ ignoreAttributes: true, suppressEmptyNode: false });

/** Wraps the Root payload object as XML inside FG's SOAP envelope. */
export function buildSoapEnvelope(operation: FgOperation, root: Record<string, unknown>): string {
  const method = SOAP_METHODS[operation];
  const rootXml = xmlBuilder.build({ Root: root });
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">` +
    `<soapenv:Header/><soapenv:Body><tem:${method}>` +
    `<tem:Product>MOTOR</tem:Product><tem:systemname></tem:systemname>` +
    `<tem:XML><![CDATA[${rootXml}]]></tem:XML>` +
    `</tem:${method}></soapenv:Body></soapenv:Envelope>`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** YYYY-MM-DD → DD/MM/YYYY (FG's date format). */
export function toFgDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function addYearsIso(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // End date is one day before the anniversary (insurer convention).
  const end = new Date(Date.UTC((y ?? 1970) + years, (m ?? 1) - 1, d ?? 1));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

function policyDates(req: MotorQuoteRequest, tenureYears: number): { start: string; end: string } {
  const start = req.policyStartDate ?? new Date().toISOString().slice(0, 10);
  const end = req.policyEndDate ?? addYearsIso(start, tenureYears);
  return { start: toFgDate(start), end: toFgDate(end) };
}

function manufacturingYear(req: MotorQuoteRequest): string {
  return req.registrationDate.slice(0, 4);
}

function bodyType(req: MotorQuoteRequest): string {
  return req.vehicleType === "fourWheeler" || req.vehicleType === "newVehicle" ? "SALOON" : "";
}

// FG add-ons are provider-specific cover codes chosen from the master catalog
// (see GET /providers/fg/addons). The frontend passes the selected CoverCodes
// through verbatim; nothing is derived from the generic boolean flags.
function buildAddons(req: MotorQuoteRequest): Array<{ CoverCode: string }> {
  const codes = req.providerAddonCodes ?? [];
  return codes.filter((c) => Boolean(c)).map((CoverCode) => ({ CoverCode }));
}

// FG's JSON gateway enforces strict model validation: several nested objects
// must be present even when empty (verified against live UAT GetQuote).
const EMPTY_CPA = {
  CPANomName: "",
  CPANomAge: "",
  CPANomAgeDet: "",
  CPANomPerc: "",
  CPARelation: "",
  CPAAppointeeName: "",
  CPAAppointeRel: "",
};
const EMPTY_NPA = [
  {
    NPAName: "",
    NPALimit: "",
    NPANomName: "",
    NPANomAge: "",
    NPANomAgeDet: "",
    NPARel: "",
    NPAAppinteeName: "",
    NPAAppinteeRel: "",
  },
];
const EMPTY_PA = {
  InsurerName: "",
  ExistingPAPolicyNo: "",
  ExistingPASumInsured: "",
  AlternatePolicyExpiryDate: "",
  ValidLicense: "",
};
const EMPTY_ADDRESS = {
  AddrLine1: "",
  AddrLine2: "",
  AddrLine3: "",
  Landmark: "",
  Pincode: "",
  City: "",
  State: "",
  Country: "",
  AddressType: "R",
  HomeTelNo: "",
  OfficeTelNo: "",
  FAXNO: "",
  MobileNo: "",
  EmailAddr: "",
};

/** Full Client column set (SOAP DataTable); ENQ sends it empty. */
const EMPTY_CLIENT = {
  ClientType: "I",
  CreationType: "C",
  Salutation: "",
  FirstName: "",
  LastName: "",
  DOB: "",
  Gender: "",
  MaritalStatus: "",
  Occupation: "OTHR",
  PANNo: "",
  GSTIN: "",
  AadharNo: "",
  EIANo: "",
  CKYCNo: "",
  CKYCRefNo: "",
  Address1: EMPTY_ADDRESS,
  Address2: { ...EMPTY_ADDRESS, AddressType: "K" },
};

// FG's SOAP engine reads each block into a typed .NET DataTable, so EVERY column
// must be present (even empty) in the sample's order — a subset throws
// "Column 'X' does not belong to table". Full set per the XML gateway sample.
function buildAdditionalBenefit(req: MotorQuoteRequest, cpaReq: "Y" | "N"): Record<string, unknown> {
  return {
    Discount: "0.00000",
    ElectricalAccessoriesValues: "",
    NonElectricalAccessoriesValues: "",
    FibreGlassTank: "",
    GeographicalArea: "",
    PACoverForUnnamedPassengers: req.paUnnamedPassenger ? "200000" : "",
    LegalLiabilitytoPaidDriver: req.legalLiabilityPaidDriver ? "1" : "",
    LegalLiabilityForOtherEmployees: "",
    LegalLiabilityForNonFarePayingPassengers: "",
    UseForHandicap: "",
    AntiThiefDevice: "",
    NCB: String(req.ncbPercent ?? 0),
    RestrictedTPPD: "",
    PrivateCommercialUsage: "",
    CPAYear: "3",
    CPADisc: "",
    IMT23: "",
    CPAReq: cpaReq,
    CPA: EMPTY_CPA,
    NPAReq: "N",
    NPA: EMPTY_NPA,
    ExistingPACover: "N",
    PA: EMPTY_PA,
    ZIMT34ID: "",
  };
}

function buildPreviousInsDtls(req: MotorQuoteRequest): Record<string, unknown> {
  const isNew = req.businessType === "new";
  const isRollover = req.businessType === "rollover" || req.businessType === "renewal";
  return {
    UsedCar: "N",
    UsedCarList: { PurchaseDate: "", InspectionRptNo: "", InspectionDt: "" },
    RollOver: isRollover ? "Y" : "N",
    RollOverList: {
      PolicyNo: req.previousPolicyNumber ?? "",
      InsuredName: "",
      PreviousPolExpDt: req.previousPolicyExpiryDate ? toFgDate(req.previousPolicyExpiryDate) : "",
      ClientCode: "",
      Address1: "",
      Address2: "",
      Address3: "",
      Address4: "",
      Address5: "",
      PinCode: "",
      InspectionRptNo: "",
      InspectionDt: "",
      NCBDeclartion: req.ncbPercent > 0 ? "Y" : "N",
      ClaimInExpiringPolicy: req.claimInPreviousPolicy ? "Y" : "N",
      NCBInExpiringPolicy: String(req.ncbPercent ?? 0),
      PreviousPolStartDt: "",
      TypeOfDoc: "",
      NoOfClaims: "",
    },
    NewVehicle: isNew ? "Y" : "N",
    NewVehicleList: { InspectionRptNo: "", InspectionDt: "" },
  };
}

const EMPTY_PREVIOUS_TP = {
  PreviousInsurer: "",
  TPPolicyNumber: "",
  TPPolicyEffdate: "",
  TPPolicyExpiryDate: "",
};

/** FG fallback insurer code (Future Generali itself) — accepted when no match. */
const FALLBACK_INSURER_CODE = "40000049";

function isoMinusOneYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${(y ?? 1970) - 1}-${String(m ?? 1).padStart(2, "0")}-${String(d ?? 1).padStart(2, "0")}`;
}

/**
 * FG requires PreviousTPInsDtls for standalone OD (Cover=OD); comprehensive/TP
 * send it empty. Falls back gracefully so a missing field never hard-fails the
 * quote (FG accepts flexible insurer values).
 */
function buildPreviousTp(req: MotorQuoteRequest, codes: FgResolvedCodes): Record<string, unknown> {
  if (req.selectedPolicy !== "standAloneOD") return EMPTY_PREVIOUS_TP;
  const expiry = req.previousTpExpiryDate ?? req.previousPolicyExpiryDate;
  const start =
    req.previousTpStartDate ??
    req.previousPolicyStartDate ??
    (expiry ? isoMinusOneYear(expiry) : undefined);
  return {
    PreviousInsurer: codes.previousInsurerCode ?? FALLBACK_INSURER_CODE,
    TPPolicyNumber: req.previousTpPolicyNumber ?? req.previousPolicyNumber ?? "",
    TPPolicyEffdate: start ? toFgDate(start) : "",
    TPPolicyExpiryDate: expiry ? toFgDate(expiry) : "",
  };
}

const EMPTY_RECEIPT = {
  UniqueTranKey: "",
  CheckType: "",
  BSBCode: "",
  TransactionDate: "",
  ReceiptType: "",
  Amount: "",
  TCSAmount: "",
  TranRefNo: "",
  TranRefNoDate: "",
};

function buildVehicle(
  req: MotorQuoteRequest,
  codes: FgResolvedCodes,
  opts: { idv: string; registrationNo?: string; engineNo?: string; chassisNo?: string },
): Record<string, unknown> {
  // FG requires TypeOfVehicle + VehicleClass for commercial (GCV/PCV); private
  // car works with both empty (per the working sample logs).
  const isCommercial = req.vehicleType === "commercial" || req.vehicleType === "newCommercial";
  return {
    TypeOfVehicle: isCommercial ? "O" : "",
    VehicleClass: isCommercial ? (codes.vehicleClass ?? "") : "",
    RTOCode: codes.rtoCode,
    Make: codes.make,
    ModelCode: codes.modelCode,
    RegistrationNo: opts.registrationNo ?? "",
    RegistrationDate: toFgDate(req.registrationDate),
    ManufacturingYear: manufacturingYear(req),
    FuelType: FUEL_MAP[req.fuelType] ?? "P",
    CNGOrLPG: { InbuiltKit: "N", IVDOfCNGOrLPG: "" },
    BodyType: codes.bodyType ?? bodyType(req),
    EngineNo: opts.engineNo ?? "",
    ChassiNo: opts.chassisNo ?? "",
    CubicCapacity: String(codes.engineCC ?? req.engineCC ?? ""),
    SeatingCapacity: String(codes.seatingCapacity ?? req.seatingCapacity ?? ""),
    IDV: opts.idv,
    GrossWeigh: String(codes.gvw ?? req.grossVehicleWeight ?? ""),
    CarriageCapacityFlag: "",
    ValidPUC: "Y",
    TrailerTowedBy: "",
    TrailerRegNo: "",
    NoOfTrailer: "",
    TrailerValLimPaxIDVDays: "",
    TrailerChassisNo: "",
    TrailerMfgYear: "",
    SchoolBusFlag: "",
  };
}

// Trailing Risk-level fields the SOAP engine expects after PreviousInsDtls.
const RISK_TAIL = {
  ZLLOTFLG: "",
  GARAGE: "",
  ZREFRA: "",
  ZREFRB: "",
  ZIDVBODY: "",
  COVERNT: "",
  CNTISS: "",
  ZCVNTIME: "",
  AddressSeqNo: "",
};

function buildRisk(
  req: MotorQuoteRequest,
  codes: FgResolvedCodes,
  vehicle: Record<string, unknown>,
  cpaReq: "Y" | "N",
): Record<string, unknown> {
  const { riskType, cover } = resolveContract(req);
  const addons = buildAddons(req);
  return {
    RiskType: riskType,
    Zone: codes.zone || "A",
    Cover: cover,
    Vehicle: vehicle,
    InterestParty: { Code: "", BankName: "" },
    AdditionalBenefit: buildAdditionalBenefit(req, cpaReq),
    AddonReq: addons.length > 0 ? "Y" : "N",
    Addon: addons.length > 0 ? addons : [{ CoverCode: "" }],
    PreviousTPInsDtls: buildPreviousTp(req, codes),
    PreviousInsDtls: buildPreviousInsDtls(req),
    ...RISK_TAIL,
  };
}

function policyHeader(
  req: MotorQuoteRequest,
  meta: FgPayloadMeta,
  method: "ENQ" | "CRT",
  opts: { quoteNo?: string } = {},
): Record<string, unknown> {
  const { contractType, tenureYears } = resolveContract(req);
  const { start, end } = policyDates(req, tenureYears);
  return {
    PolicyStartDate: start,
    PolicyEndDate: end,
    AgentCode: meta.agentCode,
    BranchCode: meta.branchCode,
    strPolicyQuoteNumber: opts.quoteNo ?? "",
    MajorClass: "MOT",
    ContractType: contractType,
    METHOD: method,
    PolicyIssueType: "I",
    PolicyNo: "",
    ClientID: "",
    ReceiptNo: "",
  };
}

// ─── GetQuote (METHOD = ENQ) ──────────────────────────────────────────────────

export function buildGetQuotePayload(
  req: MotorQuoteRequest,
  codes: FgResolvedCodes,
  meta: FgPayloadMeta,
  requestId: string,
): { url: string; payload: Record<string, unknown> } {
  // CPA (compulsory owner-driver PA) needs a nominee, captured at proposal; the
  // quote prices the base cover with CPAReq=N.
  // IDV "0" lets FG compute its default; a user-supplied IDV reprices the OD
  // cover (mirrors CreateProposal so the IDV control actually moves the quote).
  const idv = req.idvValue && req.idvValue > 0 ? String(req.idvValue) : "0";
  const vehicle = buildVehicle(req, codes, { idv });
  const payload = {
    Uid: requestId,
    VendorCode: meta.vendorCode,
    VendorUserId: meta.vendorCode,
    PolicyHeader: policyHeader(req, meta, "ENQ"),
    POS_MISP: { Type: "", PanNo: "" },
    Client: EMPTY_CLIENT,
    Receipt: EMPTY_RECEIPT,
    Risk: buildRisk(req, codes, vehicle, "N"),
  };
  return { url: endpoints.getQuote(), payload };
}

// ─── CreateProposal (METHOD = CRT) ────────────────────────────────────────────

export function buildCreateProposalPayload(
  req: MotorFullQuoteRequest,
  codes: FgResolvedCodes,
  meta: FgPayloadMeta,
  requestId: string,
): { url: string; payload: Record<string, unknown> } {
  const { proposer, address, vehicle } = req;
  const idv = req.idvValue && req.idvValue > 0 ? String(req.idvValue) : "0";

  const vehicleBlock = buildVehicle(req, codes, {
    idv,
    registrationNo: req.registrationNumber,
    engineNo: vehicle.engineNumber,
    chassisNo: vehicle.chassisNumber,
  });

  const clientAddress = {
    ...EMPTY_ADDRESS,
    AddrLine1: address.addressLine1,
    AddrLine2: address.addressLine2 ?? "",
    Pincode: address.pincode,
    City: address.city,
    State: address.state,
    Country: "IND",
    AddressType: "R",
    MobileNo: proposer.mobile,
    EmailAddr: proposer.email,
  };

  const payload = {
    Uid: requestId,
    VendorCode: meta.vendorCode,
    VendorUserId: meta.vendorCode,
    PolicyHeader: policyHeader(req, meta, "CRT", { quoteNo: req.quoteId }),
    POS_MISP: { Type: "", PanNo: "" },
    Client: {
      ...EMPTY_CLIENT,
      Salutation: proposer.title ? proposer.title.toUpperCase() : "MR",
      FirstName: proposer.firstName,
      LastName: proposer.lastName,
      DOB: toFgDate(proposer.dob),
      Gender: proposer.gender ?? "",
      PANNo: proposer.panNumber ?? "",
      AadharNo: proposer.aadharNumber ?? "",
      CKYCNo: req.ckyc ?? "",
      CKYCRefNo: req.kycRefId ?? "",
      Address1: clientAddress,
      Address2: clientAddress,
    },
    Receipt: EMPTY_RECEIPT,
    Risk: buildRisk(req, codes, vehicleBlock, req.paOwner ? "Y" : "N"),
  };

  // Nominee → CPA block when PA cover is taken.
  if (req.paOwner && req.nomineeName) {
    const benefit = (payload.Risk as Record<string, unknown>).AdditionalBenefit as Record<
      string,
      unknown
    >;
    benefit.CPA = {
      CPANomName: req.nomineeName,
      CPANomAge: req.nomineeAge ? String(req.nomineeAge) : "",
      CPANomAgeDet: "Y",
      CPANomPerc: "100",
      CPARelation: req.nomineeRelation ?? "",
    };
  }

  return { url: endpoints.createProposal(), payload };
}

// ─── PolicyIssuance (PolicyIssuance_Vendors) ──────────────────────────────────
// Binds the collected payment to the prior proposal (ClientID + the
// QuotationNo as strPolicyQuoteNumber) and returns the real PolicyNo. The
// Receipt block carries the payment-gateway result captured on the callback.

export function buildIssueProposalPayload(
  req: PolicyIssuanceRequest,
  meta: FgPayloadMeta,
  requestId: string,
): { url: string; payload: Record<string, unknown> } {
  const policyHeader: Record<string, unknown> = {
    strPolicyQuoteNumber: req.quoteNo,
    ...(req.policyStartDate ? { PolicyStartDate: toFgDate(req.policyStartDate) } : {}),
    ...(req.policyEndDate ? { PolicyEndDate: toFgDate(req.policyEndDate) } : {}),
    ClientID: req.clientId,
  };
  const r = req.receipt;
  const payload = {
    Uid: requestId,
    VendorCode: meta.vendorCode,
    VendorUserId: meta.vendorCode,
    PolicyHeader: policyHeader,
    Receipt: {
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
    },
  };
  return { url: endpoints.issueProposal(), payload };
}
