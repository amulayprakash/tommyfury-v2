/**
 * Imports HDFC ERGO master data using the aggregator CROSS-WALK model: HDFC's
 * codes are attached to the SAME canonical rows the UI selects from, via
 * ProviderMmvCode / ProviderRtoCode / ProviderInsurerCode (providerSlug="hdfc").
 *
 *   npm run db:import:hdfc
 *
 * Source: the vendor kit's PrivateCarMasterData.xls —
 *   Model_Master        (~10.8k rows) → ProviderMmvCode
 *   RTO Master          (~1.6k rows)  → ProviderRtoCode (line "fw")
 *   Insurance_Company   (39 rows)     → ProviderInsurerCode
 *
 * NO canonical rows are created. A vehicle or RTO HDFC has but our master does
 * not is simply unquotable by HDFC — the alternative (growing the shared master
 * with rows only one insurer can price) was considered and rejected.
 *
 * Idempotent + partition-scoped: upserts only the hdfc partition, never deletes
 * another provider's codes.
 */
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type * as XLSXType from "xlsx";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof XLSXType;

const prisma = new PrismaClient();
export const HDFC_IMPORT_SLUG = "hdfc";

const KIT_DIR =
  process.env.HDFC_KIT_DIR ??
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/HDFC API KIT/HDFC API KIT";
const MASTER_FILE = "PrivateCarMasterData.xls";
const SCENARIO_FILE = "PVTcarTestScenarios.xls";
const UNMATCHED_REPORT = "scripts/_hdfc-unmatched.json";

// The DB/FS/workbook plumbing above is wired up for Task 15's main(), which
// this file does not yet define (Task 14 is pure helpers only). Referenced
// here only to satisfy noUnusedLocals/noUnusedParameters until that lands;
// safe to leave once main() references them for real.
void existsSync;
void writeFileSync;
void XLSX;
void prisma;
void KIT_DIR;
void MASTER_FILE;
void SCENARIO_FILE;
void UNMATCHED_REPORT;

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** HDFC's TXT_FUEL labels → our canonical FuelType. */
export function normalizeHdfcFuel(raw: string): string {
  const f = String(raw ?? "").trim().toLowerCase();
  if (f.includes("hybrid")) return "hybrid";
  if (f.includes("battery") || f.includes("electric")) return "electric";
  if (f.includes("cng")) return "cng";
  if (f.includes("lpg")) return "lpg";
  if (f.includes("diesel")) return "diesel";
  return "petrol";
}

/** Canonical form for name comparison: upper case, punctuation collapsed. */
export function normalizeName(raw: string): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export interface RtoKey {
  stateCode: string;
  number: number;
}

/**
 * "MH-1-MUMBAI" → { stateCode: "MH", number: 1 }.
 *
 * Whitespace around the separators is tolerated: the real sheet contains
 * "HR-85 - AMBALA CANTT" and "WB-88 - Bishnupur", which are ordinary RTOs typed
 * inconsistently. Rejecting them would drop two serviceable RTOs from HDFC's
 * coverage for a data-entry quirk. The leading anchor still keeps a dash inside
 * the city name ("GJ-38-BAVLA-EAST") from being consumed.
 */
export function parseRtoKey(registrationStateCity: string): RtoKey | null {
  const m = String(registrationStateCity ?? "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2})\s*-\s*0*(\d{1,3})\s*-/);
  if (!m) return null;
  return { stateCode: m[1]!, number: Number(m[2]) };
}

export interface HdfcModelRow {
  make: string;
  modelCode: string;
  model: string;
  variant: string;
  fuelType: string;
  engineCC: number;
  seatingCapacity: number;
  wheels: number;
}

/** Parses a Model_Master row; returns null for rows we cannot or must not use. */
export function parseModelRow(raw: Record<string, unknown>): HdfcModelRow | null {
  const modelCode = raw.VEHICLEMODELCODE == null ? "" : String(raw.VEHICLEMODELCODE).trim();
  const make = String(raw.MANUFACTURER ?? "").trim();
  const model = String(raw.VEHICLEMODEL ?? "").trim();
  if (!modelCode || !make || !model) return null;

  // HDFC is onboarded for Private Car only. A 2-wheeler row here would be
  // cross-walked into a category HDFC cannot quote.
  const wheels = Number(raw.NUMBEROFWHEELS ?? 4);
  if (wheels && wheels !== 4) return null;

  return {
    make,
    modelCode,
    model,
    variant: String(raw.TXT_VARIANT ?? "").trim(),
    fuelType: normalizeHdfcFuel(String(raw.TXT_FUEL ?? "")),
    engineCC: Number(raw.CUBICCAPACITY ?? 0),
    seatingCapacity: Number(raw.SEATINGCAPACITY ?? 0),
    wheels: wheels || 4,
  };
}

export interface VariantCandidate {
  modelCode: string;
  variant: string;
  engineCC: number;
}

/**
 * ProviderMmvCode allows ONE code per canonical vehicle, but HDFC is
 * variant-grained. When several HDFC rows collapse onto one canonical row,
 * prefer an exact variant-name match, then a matching engine capacity, then the
 * first candidate.
 */
export function pickBestVariant(
  candidates: VariantCandidate[],
  variantName: string | undefined,
  engineCC: number | undefined,
): VariantCandidate | undefined {
  if (candidates.length === 0) return undefined;
  if (variantName) {
    const target = normalizeName(variantName);
    const exact = candidates.find((c) => normalizeName(c.variant) === target);
    if (exact) return exact;
  }
  if (engineCC) {
    const byCc = candidates.find((c) => c.engineCC === engineCC);
    if (byCc) return byCc;
  }
  return candidates[0];
}
