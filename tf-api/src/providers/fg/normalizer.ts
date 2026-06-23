import type { VehicleCategory } from "@/contracts/enums.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";
import { ProviderError } from "@/errors/app-error.ts";
import { FG_SLUG, FG_DISPLAY_NAME } from "./config.ts";

type Json = Record<string, unknown>;

/** FG numbers arrive as comma-grouped strings ("562,818", "3658.33"). */
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asArray = <T>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : [];

export interface QuoteNormalizeCtx {
  requestId: string;
  policyType: string;
  vehicleCategory: VehicleCategory;
}

/**
 * Unwraps FG's response envelopes to the `<Root>` object. The JSON gateway may
 * return the body flat, wrapped in `{ <Op>Result: … }`, under `Root`/`d`, or as
 * a JSON-encoded string — handle all of them defensively.
 */
export function extractRoot(body: unknown): Json {
  let cur: unknown = body;
  if (typeof cur === "string") cur = tryParse(cur);

  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const c = cur as Json;
    if ("Policy" in c || "Client" in c) return c;
    const next =
      c.GetQuoteResult ??
      c.CreateProposalResult ??
      c.IssueProposalResult ??
      c.PolicyIssuance_VendorsResult ??
      c.Root ??
      c.d ??
      undefined;
    if (next === undefined) break;
    cur = typeof next === "string" ? tryParse(next) : next;
  }
  return obj(cur);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface Table1Row {
  Code?: string;
  Description?: string;
  Type?: string;
  BOValue?: unknown;
}

/** Canonical add-on key ← FG premium-line Code (OD/TP section codes). */
const ADDON_BY_CODE: Record<string, keyof CanonicalQuoteResult["addonPremiums"]> = {
  ZCETR: "zeroDep", // bundled Zero Dep + Con + Eng + Tyre + RTI
  STZDP: "zeroDep",
  ZODEP: "zeroDep",
  CONSM: "consumables",
  STENG: "engineProtect",
  STTYR: "tyreProtect",
  STRTI: "rti",
  STRSA: "rsa",
  STNCB: "ncbProtection",
  CPA: "paOwner",
  IMT16: "paUnnamedPassenger",
  IMT28: "legalLiabilityPaidDriver",
};

interface ParsedPremium {
  basicOdPremium: number;
  thirdPartyPremium: number;
  totalAddonPremium: number;
  netPremium: number;
  serviceTaxAmount: number;
  grossPremium: number;
  addonPremiums: CanonicalQuoteResult["addonPremiums"];
  ownDamageDiscount: number;
}

function parsePremium(table1: Table1Row[]): ParsedPremium {
  let basicOdPremium = 0;
  let thirdPartyPremium = 0;
  let totalAddonPremium = 0;
  let grossOd = 0;
  let grossTp = 0;
  let servTaxOd = 0;
  let servTaxTp = 0;
  let ownDamageDiscount = 0;
  const addonPremiums: CanonicalQuoteResult["addonPremiums"] = {};

  for (const row of table1) {
    const code = (row.Code ?? "").trim();
    const desc = (row.Description ?? "").toLowerCase();
    const type = (row.Type ?? "").toUpperCase();
    const value = num(row.BOValue);

    if (code === "OD" && desc.includes("basic od")) basicOdPremium = value;
    else if (code === "OD" && desc.includes("special discount")) ownDamageDiscount = value;
    else if (code === "TP" && desc.includes("basic tp")) thirdPartyPremium = value;
    else if (code === "TOTALADDON") totalAddonPremium = value;
    else if (code === "Gross Premium") {
      if (type === "TP") grossTp = value;
      else grossOd = value;
    } else if (code === "ServTax") {
      if (type === "TP") servTaxTp = value;
      else servTaxOd = value;
    }

    const addonKey = ADDON_BY_CODE[code];
    if (addonKey && value > 0) {
      addonPremiums[addonKey] = (addonPremiums[addonKey] ?? 0) + value;
    }
  }

  // FG "Gross Premium" lines are pre-tax net; final = net + ServTax.
  const netPremium = grossOd + grossTp;
  const serviceTaxAmount = servTaxOd + servTaxTp;
  const grossPremium = netPremium + serviceTaxAmount;

  return {
    basicOdPremium,
    thirdPartyPremium,
    totalAddonPremium,
    netPremium,
    serviceTaxAmount,
    grossPremium,
    addonPremiums,
    ownDamageDiscount,
  };
}

/** Shared parse for GetQuote + CreateProposal (identical FG response shape). */
function buildResult(body: unknown, ctx: QuoteNormalizeCtx): CanonicalQuoteResult {
  const root = extractRoot(body);
  const client = obj(root.Client);
  const policy = obj(root.Policy);
  const dataset = obj(policy.NewDataSet);
  const table1 = asArray<Table1Row>(dataset.Table1);
  const premium = parsePremium(table1);

  const quotationNo = str(client.QuotationNo) ?? str(policy.QuotationNo) ?? "";
  const clientId = str(client.ClientId);
  const policyNumber = str(policy.PolicyNo);

  return {
    quoteNo: quotationNo,
    transactionId: quotationNo,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    policyType: ctx.policyType,
    vehicleCategory: ctx.vehicleCategory,
    idvValue: num(policy.VehicleIDV ?? root.VehicleIDV),
    basicOdPremium: premium.basicOdPremium,
    thirdPartyPremium: premium.thirdPartyPremium,
    addonPremiums: premium.addonPremiums,
    discounts: premium.ownDamageDiscount
      ? { ownDamageDiscount: premium.ownDamageDiscount }
      : {},
    totalAddonPremium: premium.totalAddonPremium,
    totalDiscount: premium.ownDamageDiscount,
    netPremium: premium.netPremium,
    serviceTaxPercent: 18,
    serviceTaxAmount: premium.serviceTaxAmount,
    grossPremium: premium.grossPremium,
    policyNumber: policyNumber || undefined,
    contractDetails: { clientId: clientId ?? null, quotationNo },
    _rawResponse: body,
  };
}

export function normalizeQuote(body: unknown, ctx: QuoteNormalizeCtx): CanonicalQuoteResult {
  const result = buildResult(body, ctx);
  if (!result.quoteNo) {
    throw new ProviderError(FG_SLUG, 200, "FG quote returned no QuotationNo", body);
  }
  return result;
}

export function normalizeProposal(body: unknown, ctx: QuoteNormalizeCtx): CanonicalQuoteResult {
  // Same response shape as a quote; ClientId + (eventual) PolicyNo are the extras,
  // already captured by buildResult. The real PolicyNo arrives only at issuance.
  return buildResult(body, ctx);
}

/**
 * Parses a PolicyIssuance_Vendors response. The premium tables are empty at
 * issuance — the meaningful output is the bound `Policy.PolicyNo` plus the
 * `ApplicationNo` and `Receipt.ReceiptNo`. Business failures are surfaced by
 * `assertFgSuccess` before this runs, so a PolicyNo here means ISSUED.
 */
export function normalizeIssuance(
  body: unknown,
  ctx: { quoteNo?: string },
): PolicyIssuanceResult {
  const root = extractRoot(body);
  const client = obj(root.Client);
  const policy = obj(root.Policy);
  const receipt = obj(root.Receipt);

  const policyNumber = str(policy.PolicyNo);
  return {
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    status: policyNumber ? "ISSUED" : "IN_PROGRESS",
    policyNumber,
    applicationNo: str(policy.ApplicationNo),
    receiptNo: str(receipt.ReceiptNo),
    clientId: str(client.ClientId),
    quoteNo: ctx.quoteNo,
    _rawResponse: body,
  };
}
