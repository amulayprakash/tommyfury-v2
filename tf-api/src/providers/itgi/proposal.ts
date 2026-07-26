import { tag } from "./format.ts";
import type { ItgiPartnerDetails } from "./mapper.ts";
import { assertItgiSuccess } from "./errors.ts";

export interface ItgiProposalContact {
  firstName: string;
  lastName: string;
  dob: string;
  mailId: string;
  mobilePhone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pinCode: string;
  salutation: string;
  sex: string;
  married: string;
  occupation: string;
  externalClientNo: string;
  insuredPAN?: string;
  insuredAadhar?: string;
}

export interface ItgiProposalVehicle {
  make: string;
  engineNumber: string;
  chassisNumber: string;
  registrationDate: string;
  manufacturingYear: number;
  rtoCity: string;
  engineCapacity?: number;
  seatingCapacity?: number;
  reg: { p1: string; p2: string; p3: string; p4: string };
}

export interface ItgiProposalCoverage {
  code: string;
  sumInsured: string | number;
  odPremium?: number;
  tpPremium?: number;
  number?: string | number;
}

export interface ItgiProposalInput {
  uniqueQuoteId: string;
  /** CKYC reference — mandatory on every ITGI proposal. */
  iurn: string;
  product: "PCP" | "TWP";
  inceptionDate: string;
  expiryDate: string;
  createdDate?: string;
  grossPremium: number;
  netPremiumPayable: number;
  serviceTax: number;
  odSumDisLoad: number;
  tpSumDisLoad: number;
  totalSumInsured: number;
  odDiscountLoading: number;
  odDiscountAmt: number;
  breakInofMorethan90days: "Y" | "N";
  zCover: "CO" | "AC";
  policyType: "CP" | "TP" | "OD" | "BP";
  nominee?: string;
  nomineeRelationship?: string;
  previousPolicyNo?: string;
  previousPolicyStartdate?: string;
  previousPolicyEnddate?: string;
  previousPolicyInsurer?: string;
  /** Single-year OD renewals must carry the running package (TP) policy. */
  tpPolicyNo?: string;
  tpInceptionDate?: string;
  tpExpiryDate?: string;
  tpInsurerName?: string;
  /** Break-in pre-inspection evidence. */
  inspectionNo?: string;
  inspectionDate?: string;
  inspectionStatus?: string;
  inspectionAgency?: string;
  validDrivingLicence?: "Y" | "N";
  alternatePACover?: "Y" | "N";
  newVehicleFlag?: "Y";
  contact: ItgiProposalContact;
  vehicle: ItgiProposalVehicle;
  coverages: ItgiProposalCoverage[];
}

const w = (name: string, value: string | number | undefined | null) => tag(`wrap:${name}`, value);

/** Builds the Partner-PG proposal body (`util:` operations + `wrap:` data). */
export function buildProposalPayload(
  input: ItgiProposalInput,
  partner: ItgiPartnerDetails,
): string {
  const c = input.contact;
  const v = input.vehicle;

  const contact =
    `<wrap:contact>` +
    w("addressLine1", c.addressLine1) +
    w("addressLine2", c.addressLine2) +
    w("addressType", "P") +
    w("city", c.city) +
    w("country", "IND") +
    w("dob", c.dob) +
    w("externalClientNo", c.externalClientNo) +
    w("firstName", c.firstName) +
    w("insuredAadhar", c.insuredAadhar) +
    w("insuredPAN", c.insuredPAN) +
    w("lastName", c.lastName) +
    w("mailId", c.mailId) +
    w("married", c.married) +
    w("mobilePhone", c.mobilePhone) +
    w("occupation", c.occupation) +
    w("otp", "Y") +
    w("pinCode", c.pinCode) +
    w("salutation", c.salutation) +
    w("sex", c.sex) +
    w("state", c.state) +
    // The CKYC reference (IURN) travels with the proposal.
    w("itgiUniqueReferenceId", input.iurn) +
    `</wrap:contact>`;

  const coverage =
    `<wrap:coverage>` +
    input.coverages
      .map(
        (cov) =>
          `<util:item>` +
          w("ODPremium", cov.odPremium) +
          w("TPPremium", cov.tpPremium) +
          w("code", cov.code) +
          w("number", cov.number) +
          w("sumInsured", cov.sumInsured) +
          `</util:item>`,
      )
      .join("") +
    `</wrap:coverage>`;

  const partnerDetail =
    `<wrap:partnerDetail>` +
    w("partnerBranch", partner.partnerBranch) +
    w("partnerCode", partner.partnerCode) +
    w("responseURL", partner.responseUrl) +
    w("subPartnerCode", partner.partnerSubBranch) +
    `</wrap:partnerDetail>`;

  const policy =
    `<wrap:policy>` +
    w("breakInofMorethan90days", input.breakInofMorethan90days) +
    w("createdDate", input.createdDate) +
    w("expiryDate", input.expiryDate) +
    w("externalBranch", partner.partnerBranch) +
    w("externalServiceConsumer", partner.partnerCode) +
    w("externalSubBranch", partner.partnerSubBranch) +
    w("grossPremium", input.grossPremium) +
    w("inceptionDate", input.inceptionDate) +
    w("netPremiumPayable", input.netPremiumPayable) +
    w("nominee", input.nominee) +
    w("nomineeRelationship", input.nomineeRelationship) +
    w("odDiscountAmt", input.odDiscountAmt) +
    w("odDiscountLoading", input.odDiscountLoading) +
    w("odSumDisLoad", input.odSumDisLoad) +
    w("previousPolicyEnddate", input.previousPolicyEnddate) +
    w("previousPolicyInsurer", input.previousPolicyInsurer) +
    w("previousPolicyNo", input.previousPolicyNo) +
    w("previousPolicyStartdate", input.previousPolicyStartdate) +
    w("product", input.product) +
    w("serviceTax", input.serviceTax) +
    w("totalSumInsured", input.totalSumInsured) +
    w("tpSumDisLoad", input.tpSumDisLoad) +
    w("uniqueQuoteId", input.uniqueQuoteId) +
    // OD-renewal only: the running package (TP) policy.
    w("tpPolicyNo", input.tpPolicyNo) +
    w("tpInceptionDate", input.tpInceptionDate) +
    w("tpExpiryDate", input.tpExpiryDate) +
    w("tpInsurerName", input.tpInsurerName) +
    `</wrap:policy>`;

  const vehicle =
    `<wrap:vehicle>` +
    w("chassisNumber", v.chassisNumber) +
    w("engineCapacity", v.engineCapacity) +
    w("engineNumber", v.engineNumber) +
    w("make", v.make) +
    w("manufacturingYear", v.manufacturingYear) +
    w("policyType", input.policyType) +
    w("registrationDate", v.registrationDate) +
    w("registrationNumber1", v.reg.p1) +
    w("registrationNumber2", v.reg.p2) +
    w("registrationNumber3", v.reg.p3) +
    w("registrationNumber4", v.reg.p4) +
    w("rtoCity", v.rtoCity) +
    w("seatingCapacity", v.seatingCapacity) +
    w("validDrivingLicence", input.validDrivingLicence) +
    w("alternatePACover", input.alternatePACover) +
    w("newVehicleFlag", input.newVehicleFlag) +
    w("zCover", input.zCover) +
    // Break-in pre-inspection evidence (empty tags when not applicable).
    w("inspectionNo", input.inspectionNo) +
    w("inspectionDate", input.inspectionDate) +
    w("inspectionStatus", input.inspectionStatus) +
    w("inspectionAgency", input.inspectionAgency) +
    `</wrap:vehicle>`;

  return (
    `<util:validateProposalRequest><util:proposalInput>` +
    contact +
    coverage +
    partnerDetail +
    policy +
    vehicle +
    `</util:proposalInput></util:validateProposalRequest>`
  );
}

export interface ItgiProposalResult {
  orderNo: string;
  traceNo: string;
  amountPayable: number;
}

/** Depth-first lookup of a `*Return` element regardless of envelope nesting. */
export function findReturn(root: unknown, key: string): Record<string, unknown> {
  if (!root || typeof root !== "object") return {};
  const o = root as Record<string, unknown>;
  if (key in o) {
    const v = o[key];
    return (Array.isArray(v) ? v[0] : v) as Record<string, unknown>;
  }
  for (const v of Object.values(o)) {
    const found = findReturn(v, key);
    if (Object.keys(found).length) return found;
  }
  return {};
}

export function parseProposalResponse(body: unknown): ItgiProposalResult {
  const r = findReturn(body, "validateProposalRequestReturn");
  assertItgiSuccess(r, "proposal");
  return {
    orderNo: String(r.orderNo ?? "").trim(),
    traceNo: String(r.traceNo ?? "").trim(),
    amountPayable: Math.round(Number(r.amountPayable ?? 0)),
  };
}
