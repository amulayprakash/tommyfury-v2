import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { isOtpSuccess, parseRegisterError } from "../api";

function axios422(data: unknown): AxiosError {
  const error = new AxiosError("Request failed with status code 422", "ERR_BAD_REQUEST");
  error.response = {
    data,
    status: 422,
    statusText: "Unprocessable Entity",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe("isOtpSuccess", () => {
  it("accepts the legacy success markers", () => {
    expect(isOtpSuccess("success")).toBe(true);
    expect(isOtpSuccess("true")).toBe(true);
    expect(isOtpSuccess("SUCCESS")).toBe(true);
    expect(isOtpSuccess(true)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isOtpSuccess("error")).toBe(false);
    expect(isOtpSuccess("false")).toBe(false);
    expect(isOtpSuccess(false)).toBe(false);
    expect(isOtpSuccess(undefined)).toBe(false);
    expect(isOtpSuccess(1)).toBe(false);
  });
});

describe("parseRegisterError", () => {
  it("extracts Laravel per-field validation messages", () => {
    const { fieldErrors, message } = parseRegisterError(
      axios422({ errors: { mobile: ["The mobile has already been taken."] } }),
    );

    expect(fieldErrors).toEqual([
      { field: "mobile", message: "The mobile has already been taken." },
    ]);
    expect(message).toBe("The mobile has already been taken.");
  });

  it("keeps multiple field errors in a stable field order", () => {
    const { fieldErrors } = parseRegisterError(
      axios422({
        errors: {
          email: ["Email already exists."],
          mobile: ["Mobile already exists."],
        },
      }),
    );

    expect(fieldErrors.map((entry) => entry.field)).toEqual(["mobile", "email"]);
  });

  it("falls back to the response message when there are no field errors", () => {
    const { fieldErrors, message } = parseRegisterError(
      axios422({ message: "Registration is temporarily disabled." }),
    );

    expect(fieldErrors).toEqual([]);
    expect(message).toBe("Registration is temporarily disabled.");
  });

  it("reports a connection problem when there is no response", () => {
    const networkError = new AxiosError("Network Error", "ERR_NETWORK");
    const { message } = parseRegisterError(networkError);
    expect(message).toMatch(/check your connection/i);
  });

  it("uses a generic message for unknown errors", () => {
    const { fieldErrors, message } = parseRegisterError(new Error("boom"));
    expect(fieldErrors).toEqual([]);
    expect(message).toMatch(/could not create your account/i);
  });
});
