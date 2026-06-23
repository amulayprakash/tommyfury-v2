import axios from "axios";

import { env } from "@/lib/env";
import type { FuelType, SupportedCategory } from "./types";

/** Normalised vehicle registration details used across the wizard. */
export interface RcDetails {
  rcNumber: string;
  registrationDate: string; // YYYY-MM-DD
  registrationExpiryDate?: string;
  ownerName?: string;
  presentAddress?: string;
  pincode?: string;
  /** Raw RTA category code, e.g. "2WN", "LMV". */
  vehicleCategoryRaw?: string;
  category: SupportedCategory;
  chassisNumber?: string;
  engineNumber?: string;
  makerDescription?: string;
  makerModel?: string;
  vehicleClass?: string;
  fuelType: FuelType;
  color?: string;
  cubicCapacity?: number;
  seatCapacity?: number;
  manufacturingDate?: string; // YYYY-MM
  registeredAt?: string;
  rtoCode?: string;
  previousInsurerName?: string;
  previousPolicyNumber?: string;
  previousPolicyExpiryDate?: string; // YYYY-MM-DD
  isPreviousPolicyExpired: boolean;
}

/** The portion of the regtech / Laravel response we consume. */
interface RcRaw {
  rc_number?: string;
  registration_date?: string;
  registration_expiry_date?: string;
  owner_name?: string;
  present_address?: string;
  vehicle_category?: string;
  vehicle_chasi_number?: string;
  vehicle_engine_number?: string;
  maker_description?: string;
  maker_model?: string;
  vehicle_class?: string;
  fuel_type?: string;
  color?: string;
  cubic_capacity?: string;
  seat_capacity?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  insurance_upto?: string;
  manufacturing_date?: string;
  registered_at?: string;
  rto_code?: string;
}

/** DD-MM-YYYY (or DD/MM/YYYY) → YYYY-MM-DD; passes through anything already ISO. */
function toIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m && m[1] && m[2] && m[3]) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

/** "M/YYYY" or "MM/YYYY" → "YYYY-MM". */
function toYearMonth(value?: string): string | undefined {
  if (!value) return undefined;
  const m = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (m && m[1] && m[2]) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return undefined;
}

function mapCategory(raw?: string, vehicleClass?: string): SupportedCategory {
  const hay = `${raw ?? ""} ${vehicleClass ?? ""}`.toUpperCase();
  if (hay.includes("2W") || hay.includes("M-CYCLE") || hay.includes("SCOOTER")) return "twoWheeler";
  return "fourWheeler";
}

function mapFuel(raw?: string): FuelType {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("diesel")) return "diesel";
  if (v.includes("electric")) return "electric";
  if (v.includes("cng")) return "cng";
  if (v.includes("lpg")) return "lpg";
  if (v.includes("hybrid")) return "hybrid";
  return "petrol";
}

/** Best-effort 6-digit pincode pulled from a free-text address. */
function extractPincode(address?: string): string | undefined {
  return address?.match(/\b(\d{6})\b/)?.[1];
}

function normalise(raw: RcRaw, fallbackRcNumber: string): RcDetails {
  const expiryIso = toIsoDate(raw.insurance_upto);
  const isExpired = expiryIso ? new Date(expiryIso) < new Date() : false;
  const cc = raw.cubic_capacity ? Number.parseFloat(raw.cubic_capacity) : undefined;
  return {
    rcNumber: raw.rc_number ?? fallbackRcNumber,
    registrationDate: toIsoDate(raw.registration_date) ?? "",
    registrationExpiryDate: toIsoDate(raw.registration_expiry_date),
    ownerName: raw.owner_name || undefined,
    presentAddress: raw.present_address || undefined,
    pincode: extractPincode(raw.present_address),
    vehicleCategoryRaw: raw.vehicle_category || undefined,
    category: mapCategory(raw.vehicle_category, raw.vehicle_class),
    chassisNumber: raw.vehicle_chasi_number || undefined,
    engineNumber: raw.vehicle_engine_number || undefined,
    makerDescription: raw.maker_description || undefined,
    makerModel: raw.maker_model || undefined,
    vehicleClass: raw.vehicle_class || undefined,
    fuelType: mapFuel(raw.fuel_type),
    color: raw.color || undefined,
    // Round to a whole cc — the quote contract requires an integer engineCC, and
    // some RCs report a fractional capacity (e.g. "97.2" for an HF Deluxe).
    cubicCapacity: Number.isFinite(cc) ? Math.round(cc as number) : undefined,
    seatCapacity: raw.seat_capacity ? Number.parseInt(raw.seat_capacity, 10) || undefined : undefined,
    manufacturingDate: toYearMonth(raw.manufacturing_date),
    registeredAt: raw.registered_at || undefined,
    rtoCode: raw.rto_code || undefined,
    previousInsurerName: raw.insurance_company || undefined,
    previousPolicyNumber: raw.insurance_policy_number || undefined,
    previousPolicyExpiryDate: expiryIso,
    isPreviousPolicyExpired: isExpired,
  };
}

/** Pulls the `{ rc_validation: { data } }` (regtech) or flat (Laravel) payload out. */
function extractRaw(body: unknown): RcRaw | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const fromRegtech = (obj.rc_validation as { data?: RcRaw } | undefined)?.data;
  if (fromRegtech) return fromRegtech;
  const fromLaravel = (obj.data as RcRaw | undefined) ?? (obj.result as RcRaw | undefined);
  if (fromLaravel && typeof fromLaravel === "object") return fromLaravel;
  // Some responses return the fields at the top level.
  if ("rc_number" in obj || "maker_description" in obj) return obj as RcRaw;
  return null;
}

/**
 * Looks up RC details via the third-party regtech API (per product decision).
 */
export async function lookupRc(rcNumber: string): Promise<RcDetails> {
  const normalised = rcNumber.trim().toUpperCase().replace(/\s+/g, "");

  const res = await axios.post(
    env.VITE_RC_API_URL,
    { rc_number: normalised },
    {
      headers: {
        "Content-Type": "application/json",
        AccessToken: env.VITE_RC_API_TOKEN,
      },
      timeout: 20_000,
    },
  );
  const raw = extractRaw(res.data);

  if (!raw) {
    throw new Error("We couldn't fetch details for this vehicle number. Please check and retry.");
  }
  return normalise(raw, normalised);
}
