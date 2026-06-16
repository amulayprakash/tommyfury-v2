import type { User } from "@/types/legacy-api";

/**
 * The only place legacy user field names are allowed to appear.
 * The Laravel API is inconsistent across endpoints (Full_Name vs name,
 * mobileno vs mobile, …), so every variant is resolved here once.
 */

function pickString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

export function mapUser(raw: Record<string, unknown>): User {
  const id = pickString(raw, ["id", "ID", "signup_id", "customer_id", "user_id"]);
  if (!id) {
    throw new Error("Login response did not contain a user id");
  }
  return {
    id,
    name: pickString(raw, ["name", "Full_Name", "full_name", "fullname", "Name"]) ?? "Customer",
    email: pickString(raw, ["email", "Email", "email_id"]),
    mobile: pickString(raw, ["mobile", "mobileno", "mobile_no", "phone", "Mobile"]),
    address: pickString(raw, ["address", "Address"]),
    pincode: pickString(raw, ["pincode", "Pincode", "pin_code"]),
  };
}

/** The legacy backend issues a separate "signup id" sent back as the X-SIGNUP-ID header. */
export function extractSignupId(raw: Record<string, unknown>): string | null {
  return pickString(raw, ["signup_id", "signupId", "id"]);
}
