import type { VehicleCategory } from "@/contracts/enums.ts";
import type { MotorQuoteRequest, MotorFullQuoteRequest } from "@/contracts/quote-request.ts";
import type { CkycRequest, OvdRequest, OvdFile } from "@/contracts/kyc.ts";
import { ProviderCapabilityError } from "@/errors/app-error.ts";
import {
  ICICI_SLUG,
  ADDON_CODES_2W,
  ADDON_CODES_4W,
  ADDON_CODES_CV,
  IDV_TYPE,
  KYC_POLICY_TYPE,
  PREV_POLICY_TYPE,
  GAS_KIT_TYPE,
  resolveProductCode,
  voluntaryDeductibleCode,
  type IciciVehicleLine,
  type IciciCvClass,
} from "./config.ts";

/** Master codes resolved (DB or pass-through) before building a payload. */
export interface IciciResolvedCodes {
  makeCode: number;
  modelCode: number;
  rtoCode: number;
  previousInsurerCode?: string;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

const lineSegment = (line: IciciVehicleLine) =>
  line === "tw" ? "motor-tw" : line === "cv" ? "motor-cv" : "motor-fw";

export const endpoints = {
  premium: (line: IciciVehicleLine) => `/generic/${lineSegment(line)}/generic/premium`,
  getQuote: (line: IciciVehicleLine, txnId: string) =>
    `/generic/${lineSegment(line)}/generic/premium/${encodeURIComponent(txnId)}`,
  proposal: (line: IciciVehicleLine) => `/generic/${lineSegment(line)}/generic/proposal`,
  policyStatus: () => `/generic/common/motor/generic/policy`,
  certificate: (txnId: string) =>
    `/generic/common/customer/generic/certificate/${encodeURIComponent(txnId)}`,
  ckyc: () => `/generic/common/ckyc/generic/ckyc`,
  ovd: () => `/generic/common/ckyc/generic/ovdinitiate`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function resolveLine(vehicleType: VehicleCategory): IciciVehicleLine {
  switch (vehicleType) {
    case "twoWheeler":
      return "tw";
    case "fourWheeler":
    case "newVehicle":
      return "fw";
    case "commercial":
    case "newCommercial":
      return "cv";
    default:
      throw new ProviderCapabilityError(ICICI_SLUG, vehicleType);
  }
}

/**
 * Commercial product class for ICICI CV product-code selection. An explicit
 * commercialVehicleClass wins (the only way to reach the MISC line); otherwise it
 * is derived from commercialSubType (passenger→PCV, goods→GCV), defaulting to GCV.
 */
function resolveCvClass(req: MotorQuoteRequest): IciciCvClass {
  if (req.commercialVehicleClass) return req.commercialVehicleClass;
  return req.commercialSubType === "passenger" ? "pcv" : "gcv";
}

function tenureYears(req: MotorQuoteRequest): number {
  if (req.policyStartDate && req.policyEndDate) {
    const years = Math.round(
      (Date.parse(req.policyEndDate) - Date.parse(req.policyStartDate)) / (365 * 86_400_000),
    );
    if (years >= 1 && years <= 3) return years;
  }
  return 1;
}

function buildAddons(req: MotorQuoteRequest, line: IciciVehicleLine): string[] {
  const map = line === "fw" ? ADDON_CODES_4W : line === "cv" ? ADDON_CODES_CV : ADDON_CODES_2W;
  // Canonical cover flag → ICICI addon code (only those the line's map supports).
  const flags: Record<string, boolean> = {
    rsa: req.rsa,
    zeroDep: req.zeroDep,
    engineProtect: req.engineProtect,
    tyreProtect: req.tyreProtect,
    rti: req.rti,
    consumables: req.consumables,
    keyProtect: req.keyProtect,
    garageCash: req.garageCash,
    lossOfBelongings: req.lossOfBelongings,
    batteryProtect: req.batteryProtect,
    drivingAccessories: req.drivingAccessories,
    ncbProtection: req.ncbProtection,
  };
  const codes = Object.entries(flags)
    .filter(([, on]) => on)
    .map(([flag]) => map[flag])
    .filter((code): code is string => Boolean(code));

  // Voluntary deductible rides in the same AddOns array (e.g. "VD-2500").
  const vd = voluntaryDeductibleCode(req.voluntaryDeductible);
  if (vd) codes.push(vd);
  return codes;
}

/** ICICI CKYC DOB format is dd-MMM-yyyy (e.g. 29-Oct-2001). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function toIciciDob(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const monthIdx = Number(m) - 1;
  return `${d}-${MONTHS[monthIdx] ?? m}-${y}`;
}

// ─── Save Quote ───────────────────────────────────────────────────────────────

export function buildSaveQuotePayload(
  req: MotorQuoteRequest,
  codes: IciciResolvedCodes,
  requestId: string,
): { line: IciciVehicleLine; url: string; payload: Record<string, unknown> } {
  const line = resolveLine(req.vehicleType);
  const cvClass = line === "cv" ? resolveCvClass(req) : undefined;
  const productCode = resolveProductCode({
    line,
    business: req.businessType,
    policyType: req.selectedPolicy,
    tenureYears: tenureYears(req),
    cvClass,
  });
  if (productCode === undefined) {
    const detail = cvClass
      ? `${req.vehicleType}/${cvClass}/${req.selectedPolicy}`
      : `${req.vehicleType}/${req.selectedPolicy}`;
    throw new ProviderCapabilityError(ICICI_SLUG, detail);
  }

  const hasIdv = typeof req.idvValue === "number" && req.idvValue > 0;
  const gasKitType = req.bifuelKitType ? GAS_KIT_TYPE[req.bifuelKitType] : GAS_KIT_TYPE.NA;

  const payload: Record<string, unknown> = {
    ProductCode: productCode,
    OwnerType: 1, // Individual
    MakeCode: codes.makeCode,
    ModelCode: codes.modelCode,
    RTOCode: codes.rtoCode,
    RegistrationNo: req.registrationNumber ?? "",
    RegistrationDate: req.registrationDate,
    ...(hasIdv ? { IDV: req.idvValue } : { IDVType: IDV_TYPE.avg }),
    Pincode: req.pincode ?? "",
    RequestId: requestId,
    IsLive: true,
    HasExistingPACover: req.paOwner,
    AddOns: buildAddons(req, line),
    PreviousPolicyClaimed: req.claimInPreviousPolicy,
    PreviousPolicyNcbPercentage: req.ncbPercent,
    PreviousPolicyExpiryDate: req.previousPolicyExpiryDate ?? null,
    PreviousInsurerCode: codes.previousInsurerCode ?? "",
    PreviousPolicyNumber: req.previousPolicyNumber ?? "",
    PreviousPolicyType: req.previousPolicyType
      ? PREV_POLICY_TYPE[req.previousPolicyType as keyof typeof PREV_POLICY_TYPE]
      : PREV_POLICY_TYPE.comprehensive,
    PreviousPolicyHasZdCover: req.previousPolicyHasZdCover ?? false,

    // PA cover sum-insured (separate from the HasExistingPACover flag).
    UnNamedPaCover: req.unnamedPaSumInsured ?? 0,
    NamedPaCover: req.namedPaSumInsured ?? 0,

    // Bi-fuel (CNG/LPG) external kit — GasKitSI mandatory when type is CNG/LPG.
    GasKitType: gasKitType,
    GasKitSI: req.bifuelKitSI ?? 0,

    // Accessories sum-insured.
    ElectricalAccessoriesSI: req.electricalAccessoriesSI ?? 0,
    NonElectricalAccessoriesSI: req.nonElectricalAccessoriesSI ?? 0,

    // Discount drivers.
    HasAntiTheftDevice: req.hasAntiTheftDevice ?? false,
    AutomobileAssociationMembershipNumber: req.automobileAssociationMembership ?? null,
    HasPayU: req.hasPayU ?? false,
    PayURange: req.payURange ?? 0,
    HasCIBIL: req.hasCibil ?? false,
    ...(req.hasCibil
      ? { ProposerName: req.proposerName ?? null, PanNumber: req.panNumber ?? null }
      : {}),

    NumberOfDriver: req.numberOfDrivers ?? 0,
    NumberOfEmployee: req.numberOfEmployees ?? 0,
  };

  // 2W carries dedicated sum-insured fields for these covers.
  if (line === "tw") {
    payload.DrivingAccessoriesSI = req.drivingAccessoriesSI ?? 0;
    payload.KeyProtectSI = req.keyProtectSI ?? 0;
  }

  // CV carries the IMT-23 endorsement flag (paid-driver/employee legal liability
  // already ride on NumberOfDriver / NumberOfEmployee set above).
  if (line === "cv") {
    payload.IsInclusionOfIMT = req.isInclusionOfIMT ?? false;
  }

  // Stand-alone OD requires the active TP policy details.
  if (req.selectedPolicy === "standAloneOD") {
    payload.ActiveTpPolicyNumber = req.previousTpPolicyNumber ?? req.previousPolicyNumber ?? null;
    payload.ActiveTpInsurerCode = codes.previousInsurerCode ?? null;
    payload.ActiveTpStartDate = req.previousTpStartDate ?? null;
    payload.ActiveTpEndDate = req.previousTpExpiryDate ?? null;
  }

  return { line, url: endpoints.premium(line), payload };
}

// ─── Proposal ─────────────────────────────────────────────────────────────────

export function buildProposalPayload(
  req: MotorFullQuoteRequest,
  codes: IciciResolvedCodes,
  requestId: string,
): { line: IciciVehicleLine; url: string; payload: Record<string, unknown> } {
  const line = resolveLine(req.vehicleType);
  const { proposer, address, vehicle } = req;

  const payload: Record<string, unknown> = {
    TransactionId: req.quoteId,
    ProposerName: `${proposer.firstName} ${proposer.lastName}`.trim(),
    EmailId: proposer.email,
    MobileNo: proposer.mobile,
    ProposerDOB: proposer.dob,
    Address: [address.addressLine1, address.addressLine2, address.city, address.state]
      .filter(Boolean)
      .join(", "),
    Pincode: address.pincode,
    RegistrationNo: req.registrationNumber ?? "",
    EngineNo: vehicle.engineNumber,
    ChassisNo: vehicle.chassisNumber,
    IsVehicleUnderLoan: req.isVehicleUnderLoan,
    FinancierName: req.financierName ?? "",
    PreviousInsurerCode: codes.previousInsurerCode ?? "",
    PreviousPolicyNumber: req.previousPolicyNumber ?? "",
    NomineeName: req.nomineeName ?? null,
    NomineeAge: req.nomineeAge ?? null,
    NomineeRelationship: req.nomineeRelation ?? null,
    AmountCollected: req.amountCollected ?? 0,
    PaymentTransactionId: req.paymentTransactionId ?? "",
    SuccessUrl: req.successUrl ?? null,
    FailureUrl: req.failureUrl ?? null,
    RequestId: requestId,
    PanNumber: proposer.panNumber ?? null,
    OdometerReading: req.odometerReading ?? 0,
    OdometerCaptureDate: req.odometerCaptureDate ?? null,
    isProposalOnly: req.isProposalOnly,
  };

  // Stand-alone OD proposal also carries the active TP policy details.
  if (req.selectedPolicy === "standAloneOD") {
    payload.ActiveTpPolicyNumber = req.previousTpPolicyNumber ?? req.previousPolicyNumber ?? null;
    payload.ActiveTpInsurerCode = codes.previousInsurerCode ?? null;
    payload.ActiveTpStartDate = req.previousTpStartDate ?? null;
    payload.ActiveTpEndDate = req.previousTpExpiryDate ?? null;
  }

  if (req.spDetail) {
    payload.SpDetail = {
      SpCode: req.spDetail.spCode,
      CustomerReferenceNumber: req.spDetail.customerReferenceNumber,
      ChannelName: req.spDetail.channelName,
      PrimaryRmCode: req.spDetail.primaryRmCode,
      SecondaryRmCode: req.spDetail.secondaryRmCode,
      Banca1: req.spDetail.banca1,
      Banca2: req.spDetail.banca2,
      Banca3: req.spDetail.banca3,
    };
  }

  return { line, url: endpoints.proposal(line), payload };
}

// ─── CKYC ─────────────────────────────────────────────────────────────────────

export function buildCkycPayload(req: CkycRequest): Record<string, unknown> {
  return {
    TransactionId: req.transactionId,
    DateOfBirth: toIciciDob(req.dob),
    PanNumber: req.panNumber ?? null,
    CkycNumber: req.ckycNumber ?? null,
    AadhaarNumber: req.aadhaarNumber ?? null,
    NameAsPerAadhaar: req.nameAsPerAadhaar ?? null,
    Gender: req.gender ?? null,
    PolicyType: KYC_POLICY_TYPE[req.policyType],
  };
}

// ─── OVD (multipart) ──────────────────────────────────────────────────────────

export function buildOvdFormData(req: OvdRequest, files: OvdFile[]): FormData {
  const form = new FormData();
  form.append("quoteTransactionId", req.transactionId);
  form.append("ProofOfIdentityType", req.proofOfIdentityType);
  form.append("ProofOfAddressType", req.proofOfAddressType);
  form.append("PolicyType", String(KYC_POLICY_TYPE[req.policyType]));

  for (const file of files) {
    // ICICI spells the identity field "ProofOfIdentify" (per the partner doc).
    const fieldName = file.fieldName === "proofOfIdentity" ? "ProofOfIdentify" : "ProofOfAddress";
    form.append(
      fieldName,
      new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
      file.originalName,
    );
  }
  return form;
}

// ─── Policy status ────────────────────────────────────────────────────────────

export function buildPolicyStatusPayload(transactionId: string): Record<string, unknown> {
  return { TransactionId: transactionId };
}
