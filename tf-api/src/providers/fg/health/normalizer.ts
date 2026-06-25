import type { HealthProduct, HealthLine } from "@/contracts/health/health-enums.ts";
import type {
  HealthQuoteResult,
  HealthMemberPremium,
} from "@/contracts/health/health-quote-result.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";
import { ProviderError } from "@/errors/app-error.ts";
import { FG_SLUG, FG_DISPLAY_NAME } from "../config.ts";

type Json = Record<string, unknown>;

/** FG numbers arrive as strings ("8555.00", "1,539.90"). */
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

export interface HealthNormalizeCtx {
  requestId: string;
  product: HealthProduct;
  line: HealthLine;
  policyTermYears: number;
}

/** Unwraps to the business `<Root>` object (transport already strips the SOAP envelope). */
export function extractHealthRoot(body: unknown): Json {
  let cur: unknown = body;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const c = cur as Json;
    if ("Policy" in c || "Client" in c || "Application" in c) return c;
    const next =
      c.CreatePolicyResult ??
      c.HealthPreCRTValidateResult ??
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

// ─── Premium parse (indemnity OutputRes) ──────────────────────────────────────

function parseMembers(policy: Json): { members: HealthMemberPremium[]; sumInsured: number } {
  const input = obj(policy.InputParameters);
  const bene = obj(input.BeneficiaryDetails);
  const rows = asArray<Json>(bene.Member);
  let sumInsured = 0;
  const members = rows.map((m, i): HealthMemberPremium => {
    const si = num(m.SumInsured);
    sumInsured += si;
    return {
      memberId: Number(m.MemberId ?? i + 1) || i + 1,
      name: str(m.InsuredName),
      relation: str(m.Relation),
      age: m.Age != null ? num(m.Age) : undefined,
      sumInsured: si || undefined,
      coverType: str(m.CoverType),
      basePremium: m.BeneBasePremium != null ? num(m.BeneBasePremium) : undefined,
      loadingAmount: m.BMILoadAmount != null ? num(m.BMILoadAmount) : undefined,
      loadingPercent: m.TotalLoadingPercent != null ? num(m.TotalLoadingPercent) : undefined,
      perPersonPremium: m.PerPersonPremium != null ? num(m.PerPersonPremium) : undefined,
    };
  });
  return { members, sumInsured };
}

function buildIndemnityResult(root: Json, ctx: HealthNormalizeCtx): HealthQuoteResult {
  const policy = obj(root.Policy);
  const output = obj(policy.OutputRes);
  const { members, sumInsured } = parseMembers(policy);

  const basePremium = num(output.BasePremium);
  const totalDiscount =
    num(output.FamilyDiscount) + num(output.OnlineDisc) + num(output.EmpDisc) + num(output.LngTrmDisc);
  const totalLoading =
    num(output.SmokingLoading) + num(output.GutkhaLoading) + num(output.InstallLoad);
  const serviceTaxAmount = num(output.ServiceTax);
  const serviceTaxPercent = num(output.ServiceTaxRate) || 18;
  const grossPremium = num(output.PremWithServTax);
  const netPremium = num(output.PremWithoutServTax) || Math.max(grossPremium - serviceTaxAmount, 0);

  const client = obj(root.Client);
  return {
    quoteNo: str(client.QuotationNo) ?? str(policy.QuotationNo) ?? ctx.requestId,
    transactionId: str(client.QuotationNo) ?? str(policy.QuotationNo) ?? ctx.requestId,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    product: ctx.product,
    line: ctx.line,
    sumInsured,
    policyTermYears: ctx.policyTermYears,
    members,
    basePremium,
    totalDiscount,
    totalLoading,
    netPremium,
    serviceTaxPercent,
    serviceTaxAmount,
    grossPremium,
    policyNumber: str(policy.PolicyNo) || undefined,
    clientId: str(client.ClientId) || undefined,
    contractDetails: { clientId: str(client.ClientId) ?? null },
    _rawResponse: root,
  };
}

// ─── PA result (cover-level premiums) ─────────────────────────────────────────

function buildPaResult(root: Json, ctx: HealthNormalizeCtx): HealthQuoteResult {
  const policy = obj(root.Policy);
  const output = obj(policy.OutputRes);
  // PA may return per-cover premiums under Insured/PrimaryCover; sum them as a fallback.
  let gross = num(output.PremWithServTax);
  let net = num(output.PremWithoutServTax);
  let tax = num(output.ServiceTax);
  let sumInsured = 0;
  if (!gross) {
    for (const ins of asArray<Json>(policy.Insured ?? obj(policy.InputParameters).Insured)) {
      const pc = obj(ins.PrimaryCover);
      for (const cv of asArray<Json>(pc.Cover)) {
        net += num(cv.Premium);
        sumInsured += num(cv.SumInsured);
      }
    }
    gross = net + tax;
  }
  const serviceTaxPercent = num(output.ServiceTaxRate) || 18;
  if (!tax && net) tax = Math.round(net * (serviceTaxPercent / 100) * 100) / 100;
  return {
    quoteNo: ctx.requestId,
    transactionId: ctx.requestId,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    product: ctx.product,
    line: ctx.line,
    sumInsured,
    policyTermYears: ctx.policyTermYears,
    members: [],
    basePremium: net,
    totalDiscount: num(output.Discount),
    totalLoading: 0,
    netPremium: net,
    serviceTaxPercent,
    serviceTaxAmount: tax,
    grossPremium: gross || net,
    _rawResponse: root,
  };
}

export function normalizeHealthQuote(body: unknown, ctx: HealthNormalizeCtx): HealthQuoteResult {
  const root = extractHealthRoot(body);
  return ctx.line === "pa" ? buildPaResult(root, ctx) : buildIndemnityResult(root, ctx);
}

export function normalizeHealthProposal(body: unknown, ctx: HealthNormalizeCtx): HealthQuoteResult {
  // Same response shape as a quote; ClientId / PolicyNo are captured when present.
  return normalizeHealthQuote(body, ctx);
}

/**
 * Parses a health issuance (CreatePolicy CRT) response. The meaningful output is
 * the bound `Policy.PolicyNo` plus `Application.ApplicationNo`, `Client.ClientId`
 * and `Receipt.ReceiptNo`. Business failures are surfaced by assertFgSuccess first.
 */
export function normalizeHealthIssuance(
  body: unknown,
  ctx: { requestId?: string },
): PolicyIssuanceResult {
  const root = extractHealthRoot(body);
  const client = obj(root.Client);
  const policy = obj(root.Policy);
  const receipt = obj(root.Receipt);
  const application = obj(root.Application);

  const policyNumber = str(policy.PolicyNo);
  return {
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    status: policyNumber ? "ISSUED" : "IN_PROGRESS",
    policyNumber,
    applicationNo: str(application.ApplicationNo) ?? str(policy.ApplicationNo),
    receiptNo: str(receipt.ReceiptNo),
    clientId: str(client.ClientId),
    quoteNo: ctx.requestId,
    message: str(policy.Message),
    _rawResponse: root,
  };
}

/** Guards against an indemnity quote that returned no premium at all. */
export function assertHealthQuotePriced(result: HealthQuoteResult, body: unknown): HealthQuoteResult {
  if (result.grossPremium <= 0 && result.netPremium <= 0) {
    throw new ProviderError(FG_SLUG, 200, "FG health quote returned no premium", body, "NO_QUOTE");
  }
  return result;
}
