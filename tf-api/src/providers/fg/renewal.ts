import { ProviderError } from "@/errors/app-error.ts";
import { requireFields } from "@/lib/require-fields.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";
import type {
  RenewalQuoteRequest,
  RenewalProposalRequest,
  RenewalCreatePolicyRequest,
} from "@/contracts/renewal.ts";
import { FG_SLUG, FG_DISPLAY_NAME } from "./config.ts";
import type { FgConfig } from "./config.ts";
import { toFgDate } from "./mapper.ts";
import { classifyFgError } from "./http.ts";

/**
 * FG (Generali Central) Motor RenewalModify — Renewal/1.0.0/RenewalModify.
 * Full JSON, three POST ops on the rebranded gateway:
 *   ModifyRenewalQuote          → fetch the expiring-policy snapshot + base premium
 *   ModifyRenewalProposal       → echo the snapshot + a constrained modify delta
 *   ModifyRenewalPolicyIssuance → bind the payment receipt → new policyNumber
 *
 * ⚠ AUTH HEADER: the token is a WSO2 password-grant token (fetched exactly like
 * every other FG product) but is sent in an `Internal-Key` header — NOT
 * `Authorization: Bearer`. The GCI docx prose says "Bearer Token"; every actual
 * curl uses `Internal-Key`. We follow the curls. CONFIRM with FG. A
 * `Cookie: sess_map` appears in some samples — treated as optional and omitted.
 *
 * ⚠ Load-bearing FG misspellings are preserved verbatim in the JSON keys we read
 * and write: PolicyHolderDeatils, ExipryDate, ChassiNo, ENgineNo, VehicaleIDV,
 * NCBPercntage, RegistrationNO. Do not "correct" them.
 *
 * Spec: GCI Motor Modify Renewal Document (+ kit CURLs).
 */

// ── value helpers ────────────────────────────────────────────────────────────

/**
 * FG money/IDV values arrive as comma-grouped decimal strings ("256,500",
 * "7468.80") on the Quote response and as plain floats on the Proposal response.
 * Strip separators and round to whole rupees — canonical money is INR integers.
 */
function rupees(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * Parse an FG numeric string (possibly comma-grouped) to a float; 0 if
 * blank/unparseable. Unlike `rupees()` this does NOT round — used for %-values
 * (e.g. DiscountPercentage) that must keep their fractional part.
 */
const numf = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

// CoverCode → canonical policy type; ProductCode → canonical vehicle category.
const COVER_TO_POLICY: Record<string, string> = {
  CO: "comprehensive",
  OD: "standAloneOD",
  LO: "thirdParty",
};
function productToCategory(code: string): string {
  // FCV/FGV/FPC are commercial; FPV/FVO/F13 (and default) are four-wheeler.
  return code.startsWith("FC") || code === "FGV" || code === "FPC"
    ? "commercial"
    : "fourWheeler";
}

// ── transport ────────────────────────────────────────────────────────────────

/** POST JSON to a RenewalModify op with the token in an `Internal-Key` header. */
async function postJson(
  url: string,
  token: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "*/*",
      "Internal-Key": token,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ProviderError(
      FG_SLUG,
      res.status,
      `FG renewal request failed [${res.status}]`,
      text.slice(0, 500),
    );
  }
  try {
    return obj(JSON.parse(text));
  } catch {
    throw new ProviderError(FG_SLUG, 200, "FG renewal returned non-JSON", text.slice(0, 500));
  }
}

/**
 * FG renewal signals failure via a `Status`/`status` of "Fail"/"Failed" plus an
 * `ErrorCode`/`ErrorDescription`. A *Success* carrying `ErrorCode: "0"` + a
 * Break-in `ErrorDescription` is NOT a failure (it flags the inspection
 * requirement) — Status stays "Success", so this guard lets it through.
 */
function assertRenewalSuccess(body: Record<string, unknown>, context: string): void {
  const status = (str(body.Status) ?? str(body.status) ?? "").toLowerCase();
  if (!status.startsWith("fail") && !status.startsWith("error")) return;
  const message =
    str(body.ErrorDescription) ??
    str(body.errorDescription) ??
    str(body.ErrorCode) ??
    str(body.errorCode) ??
    "unknown error";
  throw new ProviderError(
    FG_SLUG,
    200,
    `FG ${context} failed: ${message}`,
    body,
    classifyFgError(message),
  );
}

// ── ModifyRenewalQuote ───────────────────────────────────────────────────────

/** Prices an existing policy; returns the expiring-policy snapshot + base premium. */
export async function fgRenewalQuote(
  config: FgConfig,
  req: RenewalQuoteRequest,
  token: string,
  ctx: { requestId: string },
): Promise<CanonicalQuoteResult> {
  const body = {
    policyNo: req.policyNo,
    expiryDate: req.expiryDate ? toFgDate(req.expiryDate) : "",
    registrationNo: req.registrationNo ?? "",
    vendorCode: config.vendorCode,
  };
  const root = await postJson(`${config.renewal.baseUrl}/ModifyRenewalQuote`, token, body);
  assertRenewalSuccess(root, "renewal-quote");

  const old = obj(root.OldPolicyDetails);
  const holder = obj(root.PolicyHolderDeatils);
  const vehicle = obj(root.VehicleDetails);
  const od = obj(root.ODPremium);
  const tp = obj(root.TPPremium);

  const proposalNo = str(old.ProposalNo) ?? `00${req.policyNo}`;
  const coverCode = str(old.CoverCode) ?? "CO";
  const productCode = str(old.ProductCode) ?? "FPV";

  const grossPremium = rupees(root.FinalPremium);
  const serviceTaxAmount = rupees(root.ServiceTax);
  const basicOdPremium = rupees(od.GrossPremium);
  const thirdPartyPremium = rupees(tp.GrossPremium);
  const totalAddonPremium = rupees(od.TotalAddon);
  const idvValue = rupees(vehicle.VehicleIDV);
  const netPremium = Math.max(grossPremium - serviceTaxAmount, 0);

  // A Success with a Break-in ErrorDescription flags the inspection requirement.
  const errorDesc = str(root.ErrorDescription) ?? "";
  const isInspectionRequired = /break-?in/i.test(errorDesc);

  return {
    quoteNo: proposalNo,
    transactionId: proposalNo,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    policyType: COVER_TO_POLICY[coverCode] ?? "comprehensive",
    vehicleCategory: productToCategory(productCode),
    idvValue,
    basicOdPremium,
    thirdPartyPremium,
    addonPremiums: {},
    discounts: {},
    totalAddonPremium,
    totalDiscount: 0,
    netPremium,
    serviceTaxPercent: 18,
    serviceTaxAmount,
    grossPremium,
    isInspectionRequired,
    contractDetails: {
      previousPolicyNo: str(old.PolicyNo) ?? req.policyNo,
      proposalNo,
      productCode,
      coverCode,
      agentCode: str(old.AgentCode),
      branch: str(old.Branch),
      clientCode: str(holder.ClientID),
      ckycStatus: str(holder.CKYCStatus),
      registrationNo: str(vehicle.RegistrationNO),
      expiryDate: str(old.ExipryDate),
      // Echo the quote's discount % (negative) for the proposal step. Surfaced
      // as a number so callers thread it straight into the proposal request.
      discountPercentage: numf(od.DiscountPercentage),
      previousPolicyNCB: str(od.PreviousPolicyNCB),
      eligiblePolicyNCB: str(od.EligiblePolicyNCB),
    },
    _rawResponse: root,
  };
}

// ── ModifyRenewalProposal ────────────────────────────────────────────────────

/** Echoes the quote snapshot + applies the modification delta; returns the
 *  bound (re-rated) premium plus the ClientID/AgentCode needed for issuance. */
export async function fgRenewalProposal(
  config: FgConfig,
  req: RenewalProposalRequest,
  token: string,
  ctx: { requestId: string },
): Promise<CanonicalQuoteResult> {
  // These are optional in the canonical schema so HDFC can share it; FG needs them.
  requireFields(req, ["productCode", "clientCode", "agentCode", "branch", "coverCode"], FG_SLUG);
  // requireFields returns void rather than narrowing, so restate the two values
  // used in typed positions (not just copied into the JSON payload) as locals.
  const productCode = req.productCode!;
  const coverCode = req.coverCode!;

  const payload = {
    ProductCode: productCode,
    PolicyDetails: {
      PreviousPolicyNo: req.previousPolicyNo,
      ProposalNo: req.proposalNo,
      StartDate: toFgDate(req.startDate),
      ExipryDate: toFgDate(req.expiryDate), // ← preserve misspelling
      ClientCode: req.clientCode,
      ...(req.ckycNo ? { CKYCNo: req.ckycNo } : {}),
      ...(req.ckycRefNo ? { CKYCRefNo: req.ckycRefNo } : {}),
    },
    ModifyDetails: {
      AgentCode: req.agentCode,
      Branch: req.branch,
      CoverCode: coverCode,
      VehicleIDV: String(req.vehicleIdv),
      DiscountPercentage: String(req.discountPercentage),
      ElectricalAccessoriesValues: req.electricalAccessoriesValues ?? "",
      NonElectricalAccessoriesValues: req.nonElectricalAccessoriesValues ?? "",
      IMT23: req.imt23 ?? "",
      IMT10: req.imt10 ?? "",
      IMT15: req.imt15 ?? "",
      IMT16: req.imt16 ?? "",
      IMT28: req.imt28 ?? "",
      IMT29: req.imt29 ?? "",
      IMT20: req.imt20 ?? "",
      ...(req.idvOfCngOrLpg !== undefined ? { IDVOfCNGOrLPG: String(req.idvOfCngOrLpg) } : {}),
      AddonCode: req.addonCodes.map((c) => ({ CoverCode: c })),
    },
    InspectionNo: req.inspectionNo ?? "",
    InspectionDate: req.inspectionDate ? toFgDate(req.inspectionDate) : "",
  };
  const root = await postJson(`${config.renewal.baseUrl}/ModifyRenewalProposal`, token, payload);
  assertRenewalSuccess(root, "renewal-proposal");

  const od = obj(root.ODPremium);
  const tp = obj(root.TPPremium);
  const proposalNo = str(root.ProposalNo) ?? req.proposalNo;

  // In ModifyRenewalProposal, `TotalPremium` is the NET (pre-tax) premium and
  // `gst` is added ON TOP (canonical grossPremium is tax-INCLUSIVE, matching the
  // Quote path where FinalPremium is gross). Corroboration: net 6595.71 + gst
  // 1187.23 = 7782.94 → gross 7783 == the ModifyRenewalPolicyIssuance sample
  // Receipt.Amount "7783" (the real payable). Do NOT invert these.
  const serviceTaxAmount = rupees(root.gst);
  const netPremium = rupees(root.TotalPremium);
  const grossPremium = netPremium + serviceTaxAmount;
  const basicOdPremium = rupees(od.GrossPremium);
  const thirdPartyPremium = rupees(tp.GrossPremium);
  const totalAddonPremium = rupees(od.TotalAddon);

  return {
    quoteNo: proposalNo,
    transactionId: proposalNo,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    policyType: COVER_TO_POLICY[coverCode] ?? "comprehensive",
    vehicleCategory: productToCategory(productCode),
    idvValue: req.vehicleIdv,
    basicOdPremium,
    thirdPartyPremium,
    addonPremiums: {},
    discounts: {},
    totalAddonPremium,
    totalDiscount: 0,
    netPremium,
    serviceTaxPercent: 18,
    serviceTaxAmount,
    grossPremium,
    contractDetails: {
      previousPolicyNo: str(root.PreviousPolicyNo) ?? req.previousPolicyNo,
      proposalNo,
      clientId: str(root.ClientID) ?? req.clientCode,
      agentCode: str(root.AgentCode) ?? req.agentCode,
      branchCode: req.branch,
    },
    _rawResponse: root,
  };
}

// ── ModifyRenewalPolicyIssuance ──────────────────────────────────────────────

/** Issues the renewal with the collected payment receipt; returns the new policy. */
export async function fgRenewalCreatePolicy(
  config: FgConfig,
  req: RenewalCreatePolicyRequest,
  token: string,
): Promise<PolicyIssuanceResult> {
  // Optional in the canonical schema so HDFC can share it; FG needs them.
  requireFields(req, ["clientId", "agentCode", "branchCode"], FG_SLUG);
  const r = req.receipt;
  const payload = {
    PolicyNo: req.policyNo,
    VendorCode: config.vendorCode,
    ClientID: req.clientId,
    RegistrationNo: req.registrationNo ?? "",
    ProposalNo: req.proposalNo,
    AgentCode: req.agentCode,
    BranchCode: req.branchCode,
    Receipt: {
      UniqueTranKey: r.uniqueTranKey,
      CheckType: r.checkType ?? "",
      BSBCode: r.bsbCode ?? "",
      TransactionDate: r.transactionDate,
      ReceiptType: r.receiptType,
      Amount: String(r.amount),
      TranRefNo: r.tranRefNo,
      TranRefNoDate: r.tranRefNoDate,
      // Renewal issuance uses `PaymentType` (motor NB uses `PGType`).
      PaymentType: r.pgType ?? "",
    },
  };
  const root = await postJson(
    `${config.renewal.baseUrl}/ModifyRenewalPolicyIssuance`,
    token,
    payload,
  );
  assertRenewalSuccess(root, "renewal-issuance");

  const policyNumber = str(root.policyNumber) ?? str(root.PolicyNo);
  return {
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    status: policyNumber ? "ISSUED" : "IN_PROGRESS",
    policyNumber,
    quoteNo: str(root.proposalNumber) ?? req.proposalNo,
    clientId: req.clientId,
    _rawResponse: root,
  };
}
