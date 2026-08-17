import type { HdfcConditions, HdfcProposer } from "./hdfc-uat-store";

/**
 * One certification scenario, ready to load into the journey.
 *
 * Unlike the FG harness — whose presets patch a handful of conditions onto a
 * vehicle the tester picks, because FG's decline list moves week to week — an
 * HDFC preset carries the WHOLE condition set. HDFC's UAT prices only vehicles
 * about a year old or newer, and these six conditions are the exact ones that
 * bound real UAT policies, so a preset that left the vehicle to the tester would
 * be a preset that mostly fails to quote.
 */
export interface HdfcTestPreset {
  id: string;
  label: string;
  /** What binding this scenario proves — shown under the label. */
  describes: string;
  conditions: HdfcConditions;
  /** Only where a scenario needs an identity other than the store's default. */
  proposerOverrides?: Partial<HdfcProposer>;
  /**
   * Add-on selection. Canonical keys (`zeroDep`, `rti`, …) become canonical
   * flags, which HDFC honours; anything else goes through as a provider cover
   * code. See `buildHdfcQuoteRequest`.
   */
  addonCodes?: string[];
  /** Shown before the tester fires the request, when the scenario cannot bind. */
  warning?: string;
}

// ─── Dates, relative to the day the tester runs ────────────────────────────────
//
// Absolute dates would rot: a rollover whose previous policy expired last month
// is a break-in, which HDFC refuses at proposal (see the break-in preset below).
// These mirror `isoOffset`/`yearsAgo` in tf-api/scripts/hdfc-uat-issuance.ts so a
// preset drives exactly what that script bound.

const todayIso = (): string => new Date().toISOString().slice(0, 10);

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const yearsAgo = (y: number): string => isoOffset(-365 * y);

/**
 * The Swift every bound scenario is built on — same make, model, RTO, engine and
 * chassis as `SWIFT`/`PROPOSER.vehicle` in the issuance script. HDFC's UAT prices
 * only vehicles roughly a year old or newer, so the registration date is a year
 * back rather than a fixed calendar date.
 */
const SWIFT = {
  makeId: "12798", makeName: "MARUTI", modelId: "12798", modelName: "SWIFT ZXI",
  fuelType: "petrol",
  rtoCode: "10406",
  engineNumber: "ENG1234567890123",
  // 17 characters — the quoting pack's chassis rule.
  chassisNumber: "MA3EWDE1S00123456",
} as const;

/**
 * A rollover sold BEFORE the outgoing policy lapses, which is how a renewal is
 * actually bought.
 *
 * The previous policy is deliberately still running. Quoting tolerates a lapsed
 * one, but CreateProposal does not: a policy that expired yesterday is a break-in
 * and HDFC answers "Break-in ID required" (live, 2026-08-13). Only the `break-in`
 * preset overrides this — the other rollovers must not become break-ins by
 * accident.
 */
const rollover = (): Pick<
  HdfcConditions,
  | "businessType" | "registrationNumber" | "registrationDate"
  | "previousPolicyNumber" | "previousPolicyExpiryDate" | "isPreviousPolicyExpired"
  | "ncbPercent"
> => ({
  businessType: "rollover",
  registrationNumber: "MH01QQ7878",
  registrationDate: yearsAgo(1),
  previousPolicyNumber: "PREVPOL0001",
  previousPolicyExpiryDate: isoOffset(7),
  isPreviousPolicyExpired: false,
  ncbPercent: 20,
});

/** Fields every preset shares and none of the six varies. */
const COMMON = {
  ...SWIFT,
  isUsedVehiclePurchase: false,
  tenureYears: 1,
  paOwner: true,
  claimInPreviousPolicy: false,
  // Left blank on the four rows that already bind: the script sent no previous
  // insurer on them, and the standalone OD is the one scenario that needs it.
  previousInsurerId: "",
  previousInsurerName: "",
} as const;

/** Every canonical cover the "all covers" row switched on, live. */
const ALL_COVERS = [
  "zeroDep", "engineProtect", "rsa", "tyreProtect", "rti", "consumables",
  "ncbProtection", "paUnnamedPassenger", "legalLiabilityPaidDriver", "lossOfBelongings",
];

/**
 * The six scenarios `tf-api/scripts/hdfc-uat-issuance.ts` drove at live HDFC UAT.
 * Five bound real policies; the sixth proves what HDFC will not bind.
 *
 * No preset sets `proposerOverrides`: all six shared one identity, and the store's
 * `DEFAULT_PROPOSER` already is that identity — nominee relation "Spouse"
 * included, with the capital S HDFC's RELATION MASTER matches case-sensitively.
 * The field exists for the scenario that eventually needs a different proposer.
 */
export const HDFC_PRESETS: HdfcTestPreset[] = [
  {
    id: "rollover-bare",
    label: "Roll Over 1+1 comprehensive, no add-ons",
    describes: "The baseline package policy. Bound live at ₹5,715.",
    conditions: { ...COMMON, ...rollover(), planType: "comprehensive" },
    addonCodes: [],
  },
  {
    id: "rollover-all-covers",
    label: "Roll Over 1+1 comprehensive, all covers",
    describes: "Add-ons survive to issuance. Bound live at ₹14,162.",
    conditions: {
      ...COMMON, ...rollover(), planType: "comprehensive",
      // The unnamed-passenger cover needs its own sum insured; the flag alone
      // prices nothing.
      unnamedPaSumInsured: 200_000,
    },
    addonCodes: ALL_COVERS,
  },
  {
    id: "new-business-1-3",
    label: "New Business 1+3 comprehensive",
    describes: "The statutory 3-year third-party leg. Bound live at ₹22,714.",
    conditions: {
      ...COMMON,
      businessType: "new",
      // No plate yet, and the vehicle is registered today.
      registrationNumber: "",
      registrationDate: todayIso(),
      previousPolicyNumber: "",
      isPreviousPolicyExpired: false,
      ncbPercent: 0,
      planType: "comprehensive",
      // 1 year of own damage; HDFC derives the 3-year TP leg itself, which is
      // what "1+3" names. The backend reads new business off businessType, so
      // this runs under the Private Car tile without a `newVehicle` category.
      tenureYears: 1,
    },
    addonCodes: [],
  },
  {
    id: "saod",
    label: "Standalone OD 0+1",
    describes: "The OD-only product, alongside a running third-party policy. Bound live at ₹1,300.",
    conditions: {
      ...COMMON, ...rollover(), planType: "standAloneOD",
      // HDFC refused this row with "Valid TP policy is required to book SAOD
      // Policy." until the previous insurer was named: the canonical contract has
      // no separate TP-insurer field, so the backend falls PreviousPolicy_TPINSURER
      // back to this one. TATAAIG is a real shortname from the kit's
      // Insurance_Company master.
      previousInsurerId: "TATAAIG",
      previousInsurerName: "Tata AIG",
      previousTpPolicyNumber: "TPPOL0001",
      previousTpStartDate: yearsAgo(1),
      previousTpExpiryDate: isoOffset(700),
    },
    addonCodes: [],
  },
  {
    id: "liability",
    label: "Liability 0+1 (TP only)",
    describes: "The liability product. Bound live at ₹4,414.",
    conditions: { ...COMMON, ...rollover(), planType: "thirdParty" },
    addonCodes: [],
  },
  {
    id: "break-in",
    label: "Roll Over 1+1 with a >24h break-in",
    describes: "Inspection routing at proposal time. Quotes, but cannot be bound.",
    conditions: {
      ...COMMON, ...rollover(), planType: "comprehensive",
      // Cover really has lapsed here — the one scenario that SHOULD be a break-in,
      // so it overrides the baseline's still-running policy.
      previousPolicyExpiryDate: isoOffset(-3),
      isPreviousPolicyExpired: true,
    },
    addonCodes: [],
    warning:
      "HDFC will QUOTE this — you will see a break-in loading and an inspection flag — " +
      "but it will refuse the proposal with \"Break-in ID required\". HDFC's kit ships no " +
      "endpoint that issues a Break-in ID, so this scenario cannot reach a bound policy " +
      "today. Run it to certify the quote and the inspection routing, and stop there.",
  },
];

/** Find a preset by id. Unknown ids give undefined so callers need no guard. */
export function presetById(id: string | null | undefined): HdfcTestPreset | undefined {
  return HDFC_PRESETS.find((p) => p.id === id);
}
