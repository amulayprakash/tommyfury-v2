import { describe, it, expect } from "vitest";
import { MotorQuoteRequestSchema } from "@/contracts/quote-request.ts";

describe("MotorQuoteRequestSchema", () => {
  const base = {
    vehicleType: "fourWheeler",
    selectedPolicy: "comprehensive",
    businessType: "rollover",
    makeId: "MARUTI",
    makeName: "Maruti Suzuki",
    modelId: "SWIFT",
    modelName: "Swift",
    fuelType: "petrol",
    rtoCode: "DL01",
    registrationDate: "2021-06-01",
  };

  it("parses a minimal valid request with defaults applied", () => {
    const result = MotorQuoteRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.zeroDep).toBe(false);
    expect(result.data.paOwner).toBe(true);
    expect(result.data.ncbPercent).toBe(0);
    expect(result.data.isPreviousPolicyExpired).toBe(false);
  });

  it("rejects an invalid vehicleType", () => {
    const result = MotorQuoteRequestSchema.safeParse({ ...base, vehicleType: "bicycle" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed registrationDate", () => {
    const result = MotorQuoteRequestSchema.safeParse({
      ...base,
      registrationDate: "01-06-2021",
    });
    expect(result.success).toBe(false);
  });

  it("coerces string ncbPercent to number", () => {
    const result = MotorQuoteRequestSchema.safeParse({ ...base, ncbPercent: "25" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ncbPercent).toBe(25);
  });
});
