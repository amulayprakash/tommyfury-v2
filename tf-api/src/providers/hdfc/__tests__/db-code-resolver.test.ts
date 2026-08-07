import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "@/errors/app-error.ts";

const getProviderMmvCode = vi.fn();
const getProviderRtoCode = vi.fn();
const getProviderInsurerCode = vi.fn();

vi.mock("@/repositories/master.repository.ts", () => ({
  getProviderMmvCode: (...a: unknown[]) => getProviderMmvCode(...a),
  getProviderRtoCode: (...a: unknown[]) => getProviderRtoCode(...a),
  getProviderInsurerCode: (...a: unknown[]) => getProviderInsurerCode(...a),
}));

const { dbCodeResolver, passthroughCodeResolver } = await import("../db-code-resolver.ts");

const req = {
  makeId: "MAR",
  makeName: "MARUTI",
  modelId: "SWIFT",
  modelName: "SWIFT",
  variantId: "VXI",
  fuelType: "petrol",
  rtoCode: "MH01",
  previousInsurerId: "ICICI",
} as never;

beforeEach(() => {
  getProviderMmvCode.mockReset();
  getProviderRtoCode.mockReset();
  getProviderInsurerCode.mockReset();
});

describe("dbCodeResolver", () => {
  it("returns the HDFC model, RTO and previous-insurer codes", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "MARUTI", modelCode: "38908" });
    getProviderRtoCode.mockResolvedValue("10406");
    getProviderInsurerCode.mockResolvedValue("ICICILOMBARD");

    await expect(dbCodeResolver(req)).resolves.toEqual({
      modelCode: "38908",
      rtoCode: "10406",
      previousInsurerCode: "ICICILOMBARD",
    });
  });

  it("always resolves the RTO code for the four-wheeler line", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue("10406");
    getProviderInsurerCode.mockResolvedValue(undefined);

    await dbCodeResolver(req);
    expect(getProviderRtoCode).toHaveBeenCalledWith("hdfc", "MH01", "fw");
  });

  it("throws NotFound naming the vehicle when it has no HDFC code", async () => {
    getProviderMmvCode.mockResolvedValue(undefined);
    await expect(dbCodeResolver(req)).rejects.toBeInstanceOf(NotFoundError);
    await expect(dbCodeResolver(req)).rejects.toThrow(/MARUTI SWIFT/);
  });

  it("throws NotFound naming the RTO when it has no HDFC code", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue(undefined);
    await expect(dbCodeResolver(req)).rejects.toThrow(/MH01/);
  });

  it("leaves the previous insurer undefined rather than inventing one", async () => {
    // The standalone module defaulted to 'ICICILOMBARD' for every rollover.
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue("10406");
    getProviderInsurerCode.mockResolvedValue(undefined);

    const out = await dbCodeResolver(req);
    expect(out.previousInsurerCode).toBeUndefined();
  });

  it("skips the insurer lookup entirely when there is no previous insurer", async () => {
    getProviderMmvCode.mockResolvedValue({ makeCode: "M", modelCode: "1" });
    getProviderRtoCode.mockResolvedValue("10406");

    await dbCodeResolver({ ...(req as Record<string, unknown>), previousInsurerId: undefined } as never);
    expect(getProviderInsurerCode).not.toHaveBeenCalled();
  });
});

describe("passthroughCodeResolver", () => {
  it("treats canonical ids as HDFC codes for fixtures and dev", async () => {
    await expect(
      passthroughCodeResolver({ modelId: "38908", rtoCode: "10406" } as never),
    ).resolves.toEqual({ modelCode: "38908", rtoCode: "10406", previousInsurerCode: undefined });
  });
});
