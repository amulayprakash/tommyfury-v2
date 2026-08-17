import type { FgConditions } from "./fg-uat-store";

export interface FgTestPreset {
  id: string;
  label: string;
  /** Only the fields this scenario pins. Everything else is left alone. */
  patch: Partial<FgConditions>;
}

/**
 * The FG certification cases as editable starting points.
 *
 * A preset pins the *conditions* under test, never a specific vehicle — FG's
 * decline list and granted discounts change week to week, so a preset naming a
 * car would rot. The tester picks a vehicle that quotes today.
 *
 * Only cases that vary journey conditions appear here. The rest deliberately
 * have no preset:
 *   - TC_33-TC_36 (anti-theft, geographical area, AAI, restricted TPPD) verify
 *     those covers are ABSENT from FG's add-on catalog — nothing on the form changes.
 *   - TC_26/27/28/31/32 (declined model, declined RTO, blacklisted and duplicate
 *     registrations) are driven by which vehicle or plate the tester types.
 *   - TC_05/TC_09 (electric, CNG/LPG) are driven by the fuel of the chosen vehicle.
 *   - TC_08/TC_10-12/TC_23 (accessories, unnamed PA, standalone add-ons) are driven
 *     by add-on selection on the next page.
 */
export const FG_TEST_PRESETS: FgTestPreset[] = [
  { id: "TC_01", label: "TC_01 — New business (new car) incl. add-ons",
    patch: { businessType: "new", planType: "comprehensive", ncbPercent: 0,
             isPreviousPolicyExpired: false, claimInPreviousPolicy: false } },
  { id: "TC_02", label: "TC_02 — Standalone OD incl. add-ons",
    patch: { businessType: "rollover", planType: "standAloneOD", ncbPercent: 20 } },
  { id: "TC_03", label: "TC_03 — Comprehensive incl. add-ons",
    patch: { businessType: "rollover", planType: "comprehensive", ncbPercent: 20 } },
  { id: "TC_06", label: "TC_06 — CPA cover exclusion (owner-driver)",
    patch: { businessType: "rollover", planType: "comprehensive", paOwner: false } },
  { id: "TC_07", label: "TC_07 — IDV increase / decrease (±20%)",
    patch: { businessType: "new", planType: "comprehensive", ncbPercent: 0 } },
  { id: "TC_13", label: "TC_13 — NCB on standalone OD (next slab)",
    patch: { businessType: "rollover", planType: "standAloneOD", ncbPercent: 25,
             claimInPreviousPolicy: false } },
  { id: "TC_14", label: "TC_14 — PUC on rollover standalone OD",
    patch: { businessType: "rollover", planType: "standAloneOD" } },
  { id: "TC_15", label: "TC_15 — Break-in standalone OD",
    patch: { businessType: "rollover", planType: "standAloneOD",
             isPreviousPolicyExpired: true } },
  { id: "TC_16", label: "TC_16 — Break-in comprehensive (inspection required)",
    patch: { businessType: "rollover", planType: "comprehensive",
             isPreviousPolicyExpired: true } },
  { id: "TC_17", label: "TC_17 — Break-in third party (inspection waived)",
    patch: { businessType: "rollover", planType: "thirdParty",
             isPreviousPolicyExpired: true } },
  { id: "TC_18", label: "TC_18 — Break-in > 90 days, NCB denied",
    patch: { businessType: "rollover", planType: "standAloneOD",
             isPreviousPolicyExpired: true, ncbPercent: 0 } },
  { id: "TC_19", label: "TC_19 — Break-in > 90 days comprehensive, NCB denied",
    patch: { businessType: "rollover", planType: "comprehensive",
             isPreviousPolicyExpired: true, ncbPercent: 0 } },
  { id: "TC_20", label: "TC_20 — Ownership transfer (NCB zero)",
    patch: { businessType: "rollover", planType: "standAloneOD", ncbPercent: 0 } },
  { id: "TC_21", label: "TC_21 — Claim in previous policy (NCB zero)",
    patch: { businessType: "rollover", planType: "comprehensive",
             claimInPreviousPolicy: true, ncbPercent: 0 } },
  { id: "TC_22", label: "TC_22 — Vehicle older than 15 years",
    patch: { businessType: "rollover", planType: "comprehensive" } },
  { id: "TC_24", label: "TC_24 — Discount, new business (CO 1+3)",
    patch: { businessType: "new", planType: "comprehensive", ncbPercent: 0 } },
  { id: "TC_25", label: "TC_25 — Discount, comprehensive rollover (CO 1+1)",
    patch: { businessType: "rollover", planType: "comprehensive", ncbPercent: 20 } },
  { id: "TC_29", label: "TC_29 — Add-on age limit (cover disabled above limit)",
    patch: { businessType: "rollover", planType: "comprehensive" } },
  { id: "TC_30", label: "TC_30 — Advance inception beyond 45 days",
    patch: { businessType: "rollover", planType: "standAloneOD" } },
  { id: "TC_37", label: "TC_37 — CKYC verification failure (wrong PAN / DOB)",
    patch: { businessType: "rollover", planType: "comprehensive" } },
];

/** Apply a preset's patch. Unknown ids are a no-op so the UI never has to guard. */
export function applyPreset(conditions: FgConditions, presetId: string): FgConditions {
  const preset = FG_TEST_PRESETS.find((p) => p.id === presetId);
  return preset ? { ...conditions, ...preset.patch } : conditions;
}
