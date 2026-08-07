import { isoToDisplay } from "@/components/ui/date-input";

import type { ProviderAddon } from "./api/vehicle-api";

/**
 * Add-on selection rules for provider catalogues built from COMBO codes.
 *
 * FG's covers are self-contained packages that overlap — `STZDP` ("Zero Depreciation +
 * RSA + Personal Belonging + Key Loss") already contains the RSA that `STRSA` sells on
 * its own. Sending both is rejected at CreateProposal with "Invalid AddON Selected",
 * but **GetQuote prices the overlap happily**, so the customer sees a premium they can
 * never bind and only finds out at the review step. The constraint has to live here.
 *
 * The split is data-driven, not a hard-coded code list: `requiresZeroDep` marks the
 * additive extras (NCB Protection, Inconvenience Allowance), everything else is a base
 * cover package. Live-verified 2026-08-07 — `[STRSA+STZDP]` fails, while `[STZDP]`,
 * `[STRSA]`, `[ZDCNE]` and `[STZDP+STNCB]` all pass the vendor's add-on validation.
 */

/** Extras are gated on zero dep; everything else is a base cover package. */
const isExtra = (addon: ProviderAddon): boolean => addon.requiresZeroDep;

/** FG spells it both "Zero Depreciation" and "Zero Dep" across the catalogue. */
const providesZeroDep = (addon: ProviderAddon): boolean => /zero\s*dep/i.test(addon.label);

const indexBy = (catalog: ProviderAddon[]): Map<string, ProviderAddon> =>
  new Map(catalog.map((a) => [a.code, a]));

/** Does the current selection include a base package that carries zero dep? */
function hasZeroDepPackage(byCode: Map<string, ProviderAddon>, selected: string[]): boolean {
  return selected.some((code) => {
    const a = byCode.get(code);
    return Boolean(a && !isExtra(a) && providesZeroDep(a));
  });
}

/**
 * Apply a checkbox toggle, keeping the selection valid for the vendor:
 *  - at most ONE base cover package (packages overlap, so a new one replaces the old);
 *  - zero-dep extras only while the chosen package actually provides zero dep.
 */
export function toggleAddonSelection(
  catalog: ProviderAddon[],
  selected: string[],
  code: string,
  on: boolean,
): string[] {
  const byCode = indexBy(catalog);
  const target = byCode.get(code);
  if (!target) return selected;
  if (!on) return selected.filter((c) => c !== code);

  if (isExtra(target)) {
    // Needs a zero-dep package first — refuse rather than silently build an
    // invalid set the vendor will reject three steps later.
    if (!hasZeroDepPackage(byCode, selected)) return selected;
    return selected.includes(code) ? selected : [...selected, code];
  }

  // A base package replaces any previously chosen package. Extras survive only if
  // the incoming package still provides the zero dep they depend on.
  const extras = selected.filter((c) => {
    const a = byCode.get(c);
    return Boolean(a && isExtra(a));
  });
  return providesZeroDep(target) ? [code, ...extras] : [code];
}

/** Whether a catalogue row can be ticked given the current selection. */
export function isAddonSelectable(
  catalog: ProviderAddon[],
  selected: string[],
  addon: ProviderAddon,
): boolean {
  if (!isExtra(addon)) return true;
  return hasZeroDepPackage(indexBy(catalog), selected);
}

// ─── Standalone-OD previous-TP dates ──────────────────────────────────────────

const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** One policy year, ending the day BEFORE the anniversary (matches the backend). */
const addYearIso = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const end = new Date(Date.UTC((y ?? 1970) + 1, (m ?? 1) - 1, d ?? 1));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
};

/**
 * Risk start, mirroring the backend's `policyStartIso`: the day after the previous
 * policy for a live rollover, otherwise today (a break-in starts now).
 */
function riskStart(previousPolicyExpiryDate: string | undefined, today: string): string {
  return previousPolicyExpiryDate && previousPolicyExpiryDate >= today
    ? addDaysIso(previousPolicyExpiryDate, 1)
    : today;
}

/**
 * Why a standalone-OD quote can't proceed on its previous-TP dates, or null when fine.
 *
 * Standalone Own-Damage runs a full year and FG refuses a partial term, so the existing
 * third-party policy must stay in force to the very end of it — otherwise CreateProposal
 * fails with "OD Policy Expiry cannot be after TP policy expiry date". Leaving the field
 * blank is the trap: the backend falls back to the previous *policy* expiry, which is a
 * year short, so the customer hits the raw vendor error instead of a useful message.
 */
export function standaloneOdTpIssue(params: {
  previousPolicyExpiryDate?: string;
  tpExpiryDate?: string;
  today: string;
}): string | null {
  const odEnd = addYearIso(riskStart(params.previousPolicyExpiryDate, params.today));

  if (!params.tpExpiryDate) {
    return `Enter your existing third-party policy's expiry date — standalone Own-Damage cover needs it in force until ${isoToDisplay(odEnd)}.`;
  }
  if (params.tpExpiryDate < odEnd) {
    return `Own-Damage cover would run until ${isoToDisplay(odEnd)}, but your third-party policy expires ${isoToDisplay(params.tpExpiryDate)}. The third-party policy must cover the full Own-Damage year — choose Comprehensive instead, or renew once the third-party policy covers that period.`;
  }
  return null;
}
