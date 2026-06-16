import type { VehicleCategory, PolicyLifecycleStatus } from "@/contracts/enums.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { KycResult, OvdResult } from "@/contracts/kyc.ts";
import type { PolicyStatusResult, CertificateResult } from "@/contracts/policy.ts";
import { ICICI_SLUG, ICICI_DISPLAY_NAME } from "./config.ts";

type Json = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

export interface QuoteNormalizeCtx {
  requestId: string;
  policyType: string;
  vehicleCategory: VehicleCategory;
}

// ─── Save / Get Quote ─────────────────────────────────────────────────────────

export function normalizeQuote(body: unknown, ctx: QuoteNormalizeCtx): CanonicalQuoteResult {
  const b = obj(body);
  const motor = obj(b.MotorPremium);
  const od = obj(motor.MotorOwnDamage);
  const liability = obj(motor.Liability);

  const addonPremiums = {
    zeroDep: num(od.ZeroDepreciationPremium) || undefined,
    engineProtect: num(od.EngineProtectPlusPremium) || undefined,
    rsa: num(od.RsaPremium) || undefined,
    tyreProtect: num(od.TyreProtectPremium) || undefined,
    rti: num(od.ReturnToInvoicePremium) || undefined,
    consumables: num(od.ConsumablePremium) || undefined,
    keyProtect: num(od.KeyProtectPremium) || undefined,
    garageCash: num(od.GarageCashPremium) || undefined,
    lossOfBelongings: num(od.LossOfPersonalBelongingsPremium) || undefined,
    batteryProtect: num(od.BatteryProtectPremium) || undefined,
    drivingAccessories: num(od.DrivingAccessoriesPremium) || undefined,
    ncbProtection: num(od.NcbProtectionPremium) || undefined,
    paOwner: num(liability.OwnerDriverPALiability) || undefined,
    paUnnamedPassenger: num(liability.UnnamedPassengerPALiability) || undefined,
    paNamedPassenger: num(liability.NamedPassengerPALiability) || undefined,
    legalLiabilityPaidDriver: num(liability.PaidDriverLegalLiability) || undefined,
  };

  const discounts = {
    ncbPercent: num(b.NcbPercentage) || undefined,
    ncbAmount: num(b.NcbAmount) || undefined,
    antiTheft: num(od.AntiTheftDiscount) || undefined,
    aaaMembership: num(od.AutoAssnMemDiscount) || undefined,
    voluntaryDeductible: num(od.VoluntaryDiscount) || undefined,
    payU: num(od.PayUDiscount) || undefined,
  };

  const totalAddonPremium = Object.values(addonPremiums).reduce<number>((s, v) => s + (v ?? 0), 0);
  const totalDiscount =
    num(b.NcbAmount) +
    num(od.AntiTheftDiscount) +
    num(od.AutoAssnMemDiscount) +
    num(od.VoluntaryDiscount) +
    num(od.PayUDiscount);

  const transactionId = str(b.TransactionId) ?? "";

  return {
    quoteNo: transactionId,
    transactionId,
    requestId: ctx.requestId,
    providerSlug: ICICI_SLUG,
    insurerName: ICICI_DISPLAY_NAME,
    policyType: ctx.policyType,
    vehicleCategory: ctx.vehicleCategory,
    idvValue: num(b.IDV),
    minIdv: num(b.MinIDV) || undefined,
    maxIdv: num(b.MaxIDV) || undefined,
    basicOdPremium: num(b.BaseOdPremium) || num(od.BasicOD),
    thirdPartyPremium: num(b.BaseTPPremium) || num(liability.TotalLiabilityPremium),
    addonPremiums,
    discounts,
    totalAddonPremium,
    totalDiscount,
    netPremium: num(b.Premium),
    serviceTaxPercent: 18,
    serviceTaxAmount: num(b.GST),
    grossPremium: num(b.FinalPremium),
    policyStartDate: str(b.PolicyStartDate),
    policyEndDate: str(b.PolicyEndtDate), // note: ICICI misspells the key
    isInspectionRequired: b.IsInspectionRequire === true,
    _rawResponse: body,
  };
}

// ─── Proposal (merged onto the quote result) ──────────────────────────────────

export interface ProposalOverlay {
  policyNumber?: string;
  paymentUrl?: string;
  policyStartDate?: string;
  policyEndDate?: string;
  status?: string;
  contractDetails: Json;
}

export function normalizeProposal(body: unknown): ProposalOverlay {
  const b = obj(body);
  return {
    policyNumber: str(b.PolicyNo),
    paymentUrl: str(b.PaymentLink),
    policyStartDate: str(b.StartDate),
    policyEndDate: str(b.EndDate),
    status: str(b.Status),
    contractDetails: {
      policyReferenceId: str(b.PolicyReferenceId),
      status: str(b.Status),
      inspectionId: b.InspectionId ?? b.InspectionID ?? null,
      isKycSuccess: b.isKycSuccess === true,
    },
  };
}

// ─── CKYC / OVD ───────────────────────────────────────────────────────────────

export function normalizeCkyc(body: unknown): KycResult {
  const b = obj(body);
  return {
    kycId: str(b.KycID),
    isKycSuccess: b.isKycSuccess === true || b.Success === true,
    name: str(b.Name),
    dob: str(b.DOB),
    email: str(b.EmailId),
    phone: str(b.PhoneNo),
    gender: str(b.Gender),
    permanentAddress: str(b.PermanentAddress),
    correspondenceAddress: str(b.CorrespondenceAddress),
    displayMessage: str(b.DisplayMessage),
    _rawResponse: body,
  };
}

export function normalizeOvd(body: unknown): OvdResult {
  const b = obj(body);
  return {
    kycId: str(b.KycID),
    customerName: str(b.CustomerName),
    isKycSuccess: b.isKycSuccess === true || b.Success === true,
    _rawResponse: body,
  };
}

// ─── Policy status ────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, PolicyLifecycleStatus> = {
  ISSUED: "ISSUED",
  "IN PROGRESS": "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  REJECTED: "REJECTED",
  INSPECTION_PENDING: "INSPECTION_PENDING",
  "INSPECTION PENDING": "INSPECTION_PENDING",
  INSPECTION_REJECTED: "INSPECTION_REJECTED",
  INSPECTION_APPROVED: "INSPECTION_APPROVED",
  INSPECTION_CLOSED: "INSPECTION_CLOSED",
};

export function mapPolicyStatus(raw: string | undefined): PolicyLifecycleStatus {
  if (!raw) return "UNKNOWN";
  return STATUS_MAP[raw.toUpperCase()] ?? "UNKNOWN";
}

export function normalizePolicyStatus(body: unknown): PolicyStatusResult {
  const b = obj(body);
  return {
    policyReferenceId: str(b.PolicyReferenceId),
    policyNumber: str(b.PolicyNo),
    startDate: str(b.StartDate),
    endDate: str(b.EndDate),
    status: mapPolicyStatus(str(b.Status)),
    inspectionId: str(b.InspectionId ?? b.InspectionID),
    isKycSuccess: b.isKycSuccess === true,
    paymentLink: str(b.PaymentLink),
    message: str(b.Message),
    _rawResponse: body,
  };
}

// ─── Certificate (COI) ────────────────────────────────────────────────────────

export function normalizeCertificate(body: unknown): CertificateResult {
  const b = obj(body);
  return {
    coiBase64: str(b.COI) ?? "",
    status: str(b.Status),
    _rawResponse: body,
  };
}
