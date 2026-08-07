/**
 * Value formatters for the HDFC ERGO HEI payloads. Each rule here corresponds to
 * a validation failure observed on HDFC UAT — see the comment on each function.
 */

/** HDFC expects every date as DD/MM/YYYY. Accepts Date, ISO string, or DD/MM/YYYY. */
export function toHdfcDate(input?: string | Date | null): string | null {
  if (!input) return null;
  if (typeof input === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * CreateProposal needs the real plate in DASH format ("MH-01-QQ-7878").
 * Sending "MH01QQ7878" — or adding registrationNumberSection* fields — is
 * rejected by HDFC's schema.
 */
export function formatRegWithDashes(regNo?: string | null): string | null {
  if (!regNo) return null;
  const clean = String(regNo).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!clean) return null;
  if (clean === "NEW" || clean === "NULL") return "New";
  const m = clean.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) return clean; // no reliable split — send as-is rather than mangling
  return [m[1], m[2], m[3], m[4]].filter(Boolean).join("-");
}

/**
 * YearOfManufacture must be a bare 4-digit year. "10/2011" or "2011-10" crashes
 * HDFC's Blaze rules engine with "unexpected character".
 */
export function yearOnly(value?: string | number | null, fallbackDate?: string | Date): string {
  if (value != null) {
    const m = String(value).match(/(19|20)\d{2}/);
    if (m) return m[0];
  }
  if (fallbackDate) {
    const d = fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
    if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  }
  return String(new Date().getFullYear());
}

/** "Claim Status as per Customer" — HDFC's sample uses ALL CAPS YES/NO. */
export function normalizeClaim(claim?: boolean | string | null): "YES" | "NO" {
  const c = String(claim ?? "").trim().toLowerCase();
  return c === "yes" || c === "y" || c === "true" || c === "1" ? "YES" : "NO";
}

/** HDFC cover flags are numeric 0/1, not booleans. */
export function bool01(x: unknown): 0 | 1 {
  return x === true || x === 1 || x === "1" ? 1 : 0;
}

/** A handful of HDFC fields genuinely want a JSON boolean. */
export function boolTF(x: unknown): boolean {
  return x === true || x === 1 || x === "1";
}

/** Safe numeric coercion with an explicit default. */
export function num(x: unknown, d = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}
