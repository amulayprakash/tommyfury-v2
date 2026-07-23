/**
 * Single source of truth for the FG "Motor field Master.xls" shape + the pure parse
 * helpers shared by the importer (scripts/import-fg-master.ts) and the read-only parity
 * check (scripts/verify-fg-master-parity.ts). Keeping them here means a rebranded sheet
 * rename is caught by scripts/__tests__/fg-master-sheets.test.ts, and the importer and
 * the parity diff can never drift apart. No I/O — safe to import from tests.
 */

/** New (JSON-kit, rebranded Generali Central) master workbook. Double space in the
 *  filename is intentional. Overridable per-run via --xls= or FG_MASTER_XLS. */
export const FG_MASTER_DEFAULT_PATH =
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor API KIT - JSON Latest Revised Rebranding/TCS Motor KIT - JSON/Motor field  Master.xls";

/** Exact sheet names the importer reads (unchanged by the rebrand). */
export const FG_SHEETS = {
  pvtCarMmv: "PVT Car MMV",
  gcvMmv: "GCV MMV",
  pcvMmv: "PCV MMV",
  rto: "RTO Code",
  addOnCovers: "Add On Covers",
  pincode: ["Pincode Master", "Pincode Master1", "Pincode Master2"],
  occupation: "Occupation Code",
  tpInsurer: "TP Policy Insurer",
  pypInsurer: "PYP Policy Insurer", // NOT imported — surfaced as a gap by the parity check
} as const;

/** Columns every MMV sheet (PVT/GCV/PCV) must expose for pushMmv(). */
export const FG_MMV_COLUMNS = [
  "PASIA_CODE", "VEHICLE_MAKE", "VEHICLE_MODEL", "Variant_Name", "VEHICLE_TYPE",
  "FUEL_TYPE", "BODY_TYPE", "CC", "GVW", "SEATING_CAPACITY", "CARRYING_CAPACITY",
  "VEHICLE_STATUS",
] as const;

export const METRO_CITIES = new Set([
  "MUMBAI", "NAVI MUMBAI", "THANE", "DELHI", "NEW DELHI", "KOLKATA", "CHENNAI",
  "BANGALORE", "BENGALURU", "HYDERABAD", "AHMEDABAD", "PUNE",
]);

/** Coerce any cell to a trimmed string. */
export const str = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Whole-number cell → int, or null for blank / "NULL" / non-numeric. */
export const intOrNull = (v: unknown): number | null => {
  const cleaned = str(v).replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && str(v).toUpperCase() !== "NULL" && str(v) !== "" ? Math.round(n) : null;
};

/** intOrNull rendered as a string ("" for null) — used to compare numeric fields on
 *  both sides of the parity diff without format false-positives. */
export const numStr = (v: unknown): string => {
  const n = intOrNull(v);
  return n == null ? "" : String(n);
};

/** FG FUEL_TYPE (e.g. "BATTERY(B)", "PETROL") → canonical fuel used as a de-dup key part. */
export function normalizeFuel(raw: string): string {
  const v = raw.toUpperCase();
  if (v.includes("HYBRID")) return "hybrid";
  if (v.includes("DIESEL")) return "diesel";
  if (v.includes("BATTERY") || v.includes("ELECTRIC")) return "electric";
  if (v.includes("CNG")) return "cng";
  if (v.includes("LPG")) return "lpg";
  if (v.includes("PETROL")) return "petrol";
  return "petrol";
}

/** No RTO→zone in the FG master; derive it (metro city → "A", else "B"). */
export function deriveZone(city: string): string {
  return METRO_CITIES.has(city.toUpperCase()) ? "A" : "B";
}

/** Canonical MMV identity shared by the importer's de-dup and the parity diff. The
 *  importer stores makeId=VEHICLE_MAKE, modelId=PASIA_CODE, fuelType=normalizeFuel(...),
 *  so this same key joins workbook rows to DB rows. */
export function mmvKey(make: string, pasia: string, fuel: string): string {
  return `${make}|${pasia}|${fuel}`;
}
