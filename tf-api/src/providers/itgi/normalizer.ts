import type { CanonicalQuoteResult } from "@/contracts/quote-result.ts";
import { ITGI_SLUG, ITGI_COVERAGE, ITGI_DISPLAY_NAME } from "./config.ts";
import { assertItgiSuccess } from "./errors.ts";

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
/** All canonical money is whole rupees. */
const rupees = (v: unknown): number => Math.round(num(v));

/** Depth-first lookup of the first element named `key`. */
export function findFirst(root: unknown, key: string): Record<string, unknown> | undefined {
  if (!root || typeof root !== "object") return undefined;
  const o = root as Record<string, unknown>;
  if (key in o) {
    const v = o[key];
    return (Array.isArray(v) ? v[0] : v) as Record<string, unknown>;
  }
  for (const v of Object.values(o)) {
    const found = findFirst(v, key);
    if (found) return found;
  }
  return undefined;
}

/** Depth-first lookup returning every element named `key`. */
export function findAll(root: unknown, key: string): Record<string, unknown>[] {
  if (!root || typeof root !== "object") return [];
  const o = root as Record<string, unknown>;
  if (key in o) {
    const v = o[key];
    return (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
  }
  for (const v of Object.values(o)) {
    const found = findAll(v, key);
    if (found.length) return found;
  }
  return [];
}

export interface ItgiIdvResult {
  idv: number;
  minIdv: number;
  maxIdv: number;
}

export function normalizeIdv(body: unknown): ItgiIdvResult {
  const r = findFirst(body, "getVehicleIdvReturn") ?? {};
  assertItgiSuccess(r, "idv");
  return {
    idv: rupees(r.idv),
    minIdv: rupees(r.minimumIdvAllowed),
    maxIdv: rupees(r.maximumIdvAllowed),
  };
}

/**
 * The premium service returns one or two blocks: `autocoverage=false` (base) and
 * `autocoverage=true` (base + bundled add-ons, including the default
 * Depreciation Waiver). Pick the one matching what the customer elected.
 */
export function selectPremiumBlock(body: unknown, hasAddons: boolean): Record<string, unknown> {
  // New vehicles come back from getNewVehiclePremium under its own return tag.
  const blocks = [
    ...findAll(body, "getMotorPremiumReturn"),
    ...findAll(body, "getNewVehiclePremiumReturn"),
  ];
  if (blocks.length === 0) return {};
  if (blocks.length === 1) return blocks[0]!;
  const wanted = String(hasAddons);
  return blocks.find((b) => String(b.autocoverage).trim() === wanted) ?? blocks[0]!;
}

/** ITGI coverage name → canonical addonPremiums key. */
const COVERAGE_TO_ADDON: Record<string, string> = {
  [ITGI_COVERAGE.DEPRECIATION_WAIVER]: "zeroDep",
  [ITGI_COVERAGE.ENGINE_GEAR_BOX]: "engineProtect",
  [ITGI_COVERAGE.TYRE_PROTECTION]: "tyreProtect",
  [ITGI_COVERAGE.RIM]: "rimProtect",
  [ITGI_COVERAGE.CONSUMABLE]: "consumables",
  [ITGI_COVERAGE.TOWING]: "rsa",
  [ITGI_COVERAGE.PA_OWNER_DRIVER]: "paOwner",
  [ITGI_COVERAGE.PA_TO_PASSENGER]: "paUnnamedPassenger",
  [ITGI_COVERAGE.LL_EMPLOYEE]: "legalLiabilityPaidDriver",
};

export interface ItgiQuoteContext {
  requestId: string;
  quoteNo: string;
  policyType: string;
  vehicleCategory: string;
  idvValue: number;
  minIdv?: number;
  maxIdv?: number;
  hasAddons: boolean;
  policyStartDate?: string;
  policyEndDate?: string;
  isInspectionRequired?: boolean;
}

export function normalizeQuote(body: unknown, ctx: ItgiQuoteContext): CanonicalQuoteResult {
  const block = selectPremiumBlock(body, ctx.hasAddons);
  assertItgiSuccess(block, "premium");

  const covers = Array.isArray(block.coveragePremiumDetail)
    ? (block.coveragePremiumDetail as Record<string, unknown>[])
    : block.coveragePremiumDetail
      ? [block.coveragePremiumDetail as Record<string, unknown>]
      : [];

  const addonPremiums: Record<string, number> = {};
  const discounts: Record<string, number> = {};
  let totalAddonPremium = 0;

  for (const c of covers) {
    const name = String(c.coverageName ?? "").trim();
    if (name === ITGI_COVERAGE.NCB) {
      // NCB comes back as a negative OD premium; canonical discounts are positive.
      discounts.ncbAmount = Math.abs(rupees(c.odPremium));
      continue;
    }
    const key = COVERAGE_TO_ADDON[name];
    if (!key) continue;
    // Bundled add-ons report a single combined figure; base covers use od/tp.
    const premium =
      c.coveragePremium !== undefined && c.coveragePremium !== null && String(c.coveragePremium) !== ""
        ? rupees(c.coveragePremium)
        : Math.round(num(c.odPremium) + num(c.tpPremium));
    if (!premium) continue;
    addonPremiums[key] = premium;
    totalAddonPremium += premium;
  }

  const discountLoadingAmt = Math.abs(rupees(block.discountLoadingAmt));
  if (discountLoadingAmt) discounts.ownDamageDiscount = discountLoadingAmt;

  return {
    quoteNo: ctx.quoteNo,
    transactionId: ctx.quoteNo,
    requestId: ctx.requestId,
    providerSlug: ITGI_SLUG,
    insurerName: ITGI_DISPLAY_NAME,
    policyType: ctx.policyType,
    vehicleCategory: ctx.vehicleCategory,
    idvValue: ctx.idvValue,
    minIdv: ctx.minIdv,
    maxIdv: ctx.maxIdv,
    policyStartDate: ctx.policyStartDate,
    policyEndDate: ctx.policyEndDate,
    isInspectionRequired: ctx.isInspectionRequired,
    basicOdPremium: rupees(block.totalODPremium),
    thirdPartyPremium: rupees(block.totalTPPremium),
    addonPremiums,
    discounts,
    totalAddonPremium,
    totalDiscount: (discounts.ncbAmount ?? 0) + (discounts.ownDamageDiscount ?? 0),
    // `totalPremimAfterDiscLoad` is the vendor's own misspelling.
    netPremium: rupees(block.totalPremimAfterDiscLoad),
    serviceTaxPercent: 18,
    serviceTaxAmount: rupees(block.serviceTax),
    grossPremium: rupees(block.premiumPayable),
    _rawResponse: body,
  } as CanonicalQuoteResult;
}
