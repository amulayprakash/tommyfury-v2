import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "@/errors/app-error.ts";
import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import type { PolicyIssuanceResult } from "@/contracts/policy.ts";
import type { RenewalQuoteRequest, RenewalCreatePolicyRequest } from "@/contracts/renewal.ts";
import { FG_SLUG, FG_DISPLAY_NAME } from "./config.ts";
import type { FgConfig } from "./config.ts";
import { toFgDate } from "./mapper.ts";

/**
 * FG Motor Renewal (motorRenewal/1.0.0) — JSON request, XML `<Root>` response.
 * GetQuote prices an existing policy by number; CreatePolicy issues it directly
 * with the payment receipt. Spec: TCS-Renewal API Documentation UAT v1.2 +
 * GateWay_Motor_Renewal_API.postman_collection.
 */

const xml = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: true,
  trimValues: true,
});

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const asArray = <T>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : v && typeof v === "object" ? [v as T] : [];

async function postJson(url: string, token: string, body: unknown): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/xml",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ProviderError(FG_SLUG, res.status, `FG renewal request failed [${res.status}]`, text.slice(0, 500));
  }
  return text;
}

/** Unwraps the `<Root>` from a renewal XML response. */
function parseRoot(text: string): Record<string, unknown> {
  const parsed = xml.parse(text) as Record<string, unknown>;
  const root = (parsed.Root ?? parsed) as Record<string, unknown>;
  return root && typeof root === "object" ? root : {};
}

interface RenewalRow {
  Code?: string;
  Type?: string;
  BOValue?: unknown;
}

/** Prices a renewal; maps the `<PremiumBreakup>` table to the canonical result. */
export async function fgRenewalQuote(
  config: FgConfig,
  req: RenewalQuoteRequest,
  token: string,
  ctx: { requestId: string; vehicleCategory: string; policyType: string },
): Promise<CanonicalQuoteResult> {
  const body = {
    PolicyNo: req.policyNo,
    ExpiryDate: req.expiryDate ? toFgDate(req.expiryDate) : "",
    RegistrationNo: req.registrationNo ?? "",
    VendorCode: config.vendorCode,
  };
  const root = parseRoot(await postJson(`${config.renewal.baseUrl}/GetQuote`, token, body));

  const quotationNo = str(root.QuotationNo);
  if (!quotationNo) {
    throw new ProviderError(FG_SLUG, 200, "FG renewal returned no QuotationNo", root);
  }

  const dataset = (root.PremiumBreakup as Record<string, unknown> | undefined)?.NewDataSet as
    | Record<string, unknown>
    | undefined;
  const rows = asArray<RenewalRow>(dataset?.Table);

  let grossOd = 0;
  let grossTp = 0;
  let servTaxOd = 0;
  let servTaxTp = 0;
  let finalPremium = 0;
  let idv = 0;
  for (const r of rows) {
    const code = (r.Code ?? "").trim();
    const isTp = (r.Type ?? "").toUpperCase() === "TP";
    const value = num(r.BOValue);
    if (code === "Final Premium") finalPremium = value;
    else if (code === "Gross Premium") {
      if (isTp) grossTp = value;
      else grossOd = value;
    } else if (code === "ServTax") {
      if (isTp) servTaxTp = value;
      else servTaxOd = value;
    } else if (code === "VehicaleIDV" || code === "VehicleIDV") idv = value;
  }
  const netPremium = grossOd + grossTp;
  const serviceTaxAmount = servTaxOd + servTaxTp;
  const grossPremium = finalPremium || netPremium + serviceTaxAmount;

  return {
    quoteNo: quotationNo,
    transactionId: quotationNo,
    requestId: ctx.requestId,
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    policyType: ctx.policyType,
    vehicleCategory: ctx.vehicleCategory,
    idvValue: idv,
    basicOdPremium: grossOd,
    thirdPartyPremium: grossTp,
    addonPremiums: {},
    discounts: {},
    totalAddonPremium: 0,
    totalDiscount: 0,
    netPremium,
    serviceTaxPercent: 18,
    serviceTaxAmount,
    grossPremium,
    contractDetails: { quotationNo, renewalOfPolicy: req.policyNo },
    _rawResponse: root,
  };
}

/** Issues the renewal directly with the collected payment receipt. */
export async function fgRenewalCreatePolicy(
  config: FgConfig,
  req: RenewalCreatePolicyRequest,
  token: string,
): Promise<PolicyIssuanceResult> {
  const r = req.receipt;
  const body = {
    PolicyNo: req.policyNo,
    VendorCode: config.vendorCode,
    ExpiryDate: req.expiryDate ? toFgDate(req.expiryDate) : "",
    RegistrationNo: req.registrationNo ?? "",
    QuotationNo: req.quoteNo,
    CKYCRefNo: req.ckycRefNo ?? "",
    CKYCNo: req.ckycNo ?? "",
    Receipt: {
      UniqueTranKey: r.uniqueTranKey,
      CheckType: r.checkType ?? "",
      BSBCode: r.bsbCode ?? "",
      TransactionDate: r.transactionDate,
      ReceiptType: r.receiptType,
      Amount: r.amount,
      TCSAmount: r.tcsAmount ?? "",
      TranRefNo: r.tranRefNo,
      TranRefNoDate: r.tranRefNoDate,
    },
  };
  const root = parseRoot(await postJson(`${config.renewal.baseUrl}/CreatePolicy`, token, body));

  const policy = (root.Policy as Record<string, unknown> | undefined) ?? root;
  const policyNumber = str(policy.PolicyNo) ?? str(root.PolicyNo);
  return {
    providerSlug: FG_SLUG,
    insurerName: FG_DISPLAY_NAME,
    status: policyNumber ? "ISSUED" : "IN_PROGRESS",
    policyNumber,
    applicationNo: str(policy.ApplicationNo),
    receiptNo: str((root.Receipt as Record<string, unknown> | undefined)?.ReceiptNo),
    quoteNo: req.quoteNo,
    _rawResponse: root,
  };
}
