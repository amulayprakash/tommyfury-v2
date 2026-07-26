import type { VehicleCategory } from "@/contracts/enums.ts";

/** ISO `YYYY-MM-DD` → ITGI `MM/DD/YYYY`. */
export function toItgiDate(iso: string): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** ISO date + clock → ITGI `MM/DD/YYYY HH:mm:ss`. */
export function toItgiDateTime(iso: string, time = "00:00:00"): string {
  return `${toItgiDate(iso)} ${time}`;
}

export interface RegistrationParts {
  p1: string;
  p2: string;
  p3: string;
  p4: string;
}

/**
 * ITGI splits the registration number across four tags, e.g. DL10AH4567 →
 * DL / 10 / AH / 4567. Returns null when the input cannot be parsed (e.g. "NEW"
 * for an unregistered vehicle).
 */
export function splitRegistrationNumber(reg: string): RegistrationParts | null {
  const clean = reg.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const m = /^([A-Z]{2})(\d{1,3})([A-Z]{0,3})(\d{1,4})$/.exec(clean);
  if (!m) return null;
  const [, p1 = "", p2 = "", p3 = "", p4 = ""] = m;
  return { p1, p2, p3, p4 };
}

/**
 * ITGI requires a partner-unique quote id of 12–20 characters (break-in
 * proposals enforce the lower bound). Derived from our requestId so the vendor's
 * id is traceable back to our logs.
 */
export function makeUniqueQuoteId(requestId: string): string {
  const alnum = requestId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (alnum + Date.now().toString()).slice(0, 20).padEnd(12, "0");
}

/** Canonical vehicle category → ITGI contract type. */
export function itgiContractType(category: VehicleCategory): "PCP" | "TWP" {
  return category === "twoWheeler" ? "TWP" : "PCP";
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Builds `<tag>escaped</tag>`; empty/undefined values render as `<tag/>`. */
export function tag(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return `<${name}/>`;
  return `<${name}>${xmlEscape(String(value))}</${name}>`;
}
