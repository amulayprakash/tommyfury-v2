import { z } from "zod";

/**
 * Hand-written types for the live Laravel API (it has no OpenAPI spec).
 * Responses are parsed with tolerant schemas at the boundary; legacy field
 * naming quirks are normalized in feature-level mappers, never spread around.
 */

/** POST /tommicutomerlogin */
export const loginResponseSchema = z.looseObject({
  user: z.record(z.string(), z.unknown()),
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  posp_id: z.union([z.string(), z.number()]).nullish(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * POST /send_Tommyandfurry_otp and POST /otp-check-login.
 * Both return a loose `{ status }` envelope; `status` has been seen as the
 * string "success"/"true" and occasionally a boolean, so we accept all shapes
 * and interpret success in the feature layer.
 */
export const otpResponseSchema = z.looseObject({
  status: z.union([z.string(), z.boolean(), z.number()]).optional(),
  message: z.string().optional(),
});

export type OtpResponse = z.infer<typeof otpResponseSchema>;

/**
 * POST /tommicutomerregister error body. Laravel returns HTTP 422 with
 * per-field validation messages keyed by field name (e.g. mobile, email).
 */
export const registerErrorSchema = z.looseObject({
  message: z.string().optional(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type RegisterErrorBody = z.infer<typeof registerErrorSchema>;

/** Normalized user shape used everywhere inside the app. */
export interface User {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  address: string | null;
  pincode: string | null;
}
