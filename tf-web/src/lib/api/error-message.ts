import axios from "axios";

/** The vendor-API (`tf-api`) error envelope: `{ message, error: { code } }`. */
interface VendorErrorEnvelope {
  message?: string;
  error?: { code?: string };
}

/**
 * Pulls the human-readable rejection reason out of a vendor-API error response,
 * falling back to the axios/Error message and finally a caller-supplied default.
 * Axios's own `err.message` is only the generic "Request failed with status
 * code 502", so the real reason lives in the response envelope's `message`.
 */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as VendorErrorEnvelope | undefined;
    if (data?.message) return data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** The canonical error `code` from the vendor-API envelope, if present. */
export function apiErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as VendorErrorEnvelope | undefined;
    return data?.error?.code;
  }
  return undefined;
}
