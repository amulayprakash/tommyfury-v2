import axios from "axios";

import { legacyClient } from "@/lib/api/legacy-client";
import { loginResponseSchema, otpResponseSchema, registerErrorSchema } from "@/types/legacy-api";

import { extractSignupId, mapUser } from "./map-user";
import type { AuthSession } from "./auth-store";

export interface LoginCredentials {
  mobile: string;
  password: string;
}

/** Logs in against the live Laravel API and returns a normalized session. */
export async function login(credentials: LoginCredentials): Promise<AuthSession> {
  const { data } = await legacyClient.post("/tommicutomerlogin", credentials);
  const parsed = loginResponseSchema.parse(data);

  return {
    user: mapUser(parsed.user),
    accessToken: parsed.access_token,
    tokenType: parsed.token_type ?? "Bearer",
    pospId: parsed.posp_id == null ? null : String(parsed.posp_id),
    signupId: extractSignupId(parsed.user),
  };
}

// ---------------------------------------------------------------------------
// Signup flow: send OTP → verify OTP → register customer.
// Mirrors the legacy CRA SignupForm against the same Laravel endpoints.
// ---------------------------------------------------------------------------

export interface RegisterDetails {
  name: string;
  mobile: string;
  email: string;
  password: string;
  address: string;
  pincode: string;
}

/** The legacy API signals success inconsistently ("success"/"true"/boolean). */
export function isOtpSuccess(status: unknown): boolean {
  if (status === true) return true;
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    return normalized === "success" || normalized === "true";
  }
  return false;
}

/** Step 1 — trigger an OTP SMS to the given mobile number. */
export async function sendSignupOtp(mobile: string): Promise<void> {
  const { data } = await legacyClient.post("/send_Tommyandfurry_otp", null, {
    params: { mobile },
  });
  const parsed = otpResponseSchema.parse(data);
  if (!isOtpSuccess(parsed.status)) {
    throw new Error(parsed.message ?? "Could not send the OTP. Please try again.");
  }
}

/** Step 2 — verify the OTP the user received. */
export async function verifySignupOtp(mobile: string, otp: string): Promise<void> {
  // The endpoint expects multipart form fields; axios sets the boundary itself
  // for a FormData body, overriding the client's default JSON content type.
  const body = new FormData();
  body.append("otp", otp);
  body.append("mobile", mobile);

  const { data } = await legacyClient.post("/otp-check-login", body);
  const parsed = otpResponseSchema.parse(data);
  if (!isOtpSuccess(parsed.status)) {
    throw new Error(parsed.message ?? "The OTP you entered is invalid or has expired.");
  }
}

/** Step 3 — create the customer account. */
export async function registerCustomer(details: RegisterDetails): Promise<void> {
  await legacyClient.post("/tommicutomerregister", {
    name: details.name,
    email: details.email,
    mobile: details.mobile,
    password: details.password,
    type: "service",
    address: details.address,
    pincode: details.pincode,
  });
}

export type RegisterFieldName = keyof RegisterDetails;

export interface RegisterFieldError {
  field: RegisterFieldName;
  message: string;
}

const REGISTER_FIELDS: readonly RegisterFieldName[] = [
  "name",
  "mobile",
  "email",
  "password",
  "address",
  "pincode",
];

/**
 * Turns a failed register request into field-level errors (for inline display)
 * plus a human summary (for a toast). Falls back to network/generic messages.
 */
export function parseRegisterError(error: unknown): {
  fieldErrors: RegisterFieldError[];
  message: string;
} {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 422) {
      const parsed = registerErrorSchema.safeParse(error.response.data);
      if (parsed.success) {
        const fieldErrors: RegisterFieldError[] = [];
        for (const field of REGISTER_FIELDS) {
          const firstMessage = parsed.data.errors?.[field]?.[0];
          if (firstMessage) {
            fieldErrors.push({ field, message: firstMessage });
          }
        }
        const [firstFieldError] = fieldErrors;
        if (firstFieldError) {
          return { fieldErrors, message: firstFieldError.message };
        }
        if (parsed.data.message) {
          return { fieldErrors: [], message: parsed.data.message };
        }
      }
    }

    const message = (error.response?.data as { message?: string } | undefined)?.message;
    if (message) return { fieldErrors: [], message };
    if (!error.response) {
      return { fieldErrors: [], message: "Could not reach the server. Check your connection." };
    }
  }

  return { fieldErrors: [], message: "Could not create your account. Please try again." };
}
