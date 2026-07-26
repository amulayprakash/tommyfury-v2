import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectPolicyPath, isBreakIn } from "../policy-types/index.ts";
import { ItgiUnmappedCodeError } from "../errors.ts";
import type { MotorQuoteRequest } from "@/contracts/quote-request.ts";

const base = {
  vehicleType: "fourWheeler",
  selectedPolicy: "comprehensive",
  businessType: "rollover",
  registrationDate: "2020-05-10",
  previousPolicyExpiryDate: "2026-07-01",
  isPreviousPolicyExpired: false,
} as unknown as MotorQuoteRequest;

describe("itgi policy paths", () => {
  it("maps comprehensive to CO / CP", () => {
    const p = selectPolicyPath(base, new Date("2026-06-01"));
    expect(p.zcover).toBe("CO");
    expect(p.policyType).toBe("CP");
  });

  it("maps third party to AC / TP with IDV sum insured of 1", () => {
    const p = selectPolicyPath(
      { ...base, selectedPolicy: "thirdParty" } as MotorQuoteRequest,
      new Date("2026-06-01"),
    );
    expect(p.zcover).toBe("AC");
    expect(p.policyType).toBe("TP");
    expect(p.idvSumInsuredOverride).toBe(1);
  });

  it("maps standalone OD to policy type OD and requires TP policy details", () => {
    const p = selectPolicyPath(
      { ...base, selectedPolicy: "standAloneOD" } as MotorQuoteRequest,
      new Date("2026-06-01"),
    );
    expect(p.policyType).toBe("OD");
    expect(p.requiresTpPolicyDetails).toBe(true);
  });

  it("maps a new vehicle to BP and the dedicated premium endpoint", () => {
    const p = selectPolicyPath(
      { ...base, vehicleType: "newVehicle", businessType: "new" } as MotorQuoteRequest,
      new Date("2026-06-01"),
    );
    expect(p.policyType).toBe("BP");
    expect(p.newVehicleFlag).toBe("Y");
    expect(p.usesNewVehicleEndpoint).toBe(true);
  });

  it("never treats a new vehicle as a break-in", () => {
    const p = selectPolicyPath(
      { ...base, vehicleType: "newVehicle", businessType: "new" } as MotorQuoteRequest,
      new Date("2026-07-24"),
    );
    expect(p.breakIn).toBe(false);
    expect(p.inceptionOffsetDays).toBe(0);
  });

  it("detects break-in from an expired previous policy", () => {
    const asOf = new Date("2026-07-24");
    expect(isBreakIn({ ...base, previousPolicyExpiryDate: "2026-07-01" }, asOf)).toBe(true);
    expect(isBreakIn({ ...base, previousPolicyExpiryDate: "2026-08-01" }, asOf)).toBe(false);
  });

  it("flags a break-in of more than 90 days", () => {
    const asOf = new Date("2026-07-24");
    const near = selectPolicyPath({ ...base, previousPolicyExpiryDate: "2026-07-01" }, asOf);
    expect(near.breakIn).toBe(true);
    expect(near.breakInMoreThan90Days).toBe("N");
    const far = selectPolicyPath({ ...base, previousPolicyExpiryDate: "2026-01-01" }, asOf);
    expect(far.breakInMoreThan90Days).toBe("Y");
  });

  it("shifts inception by three days for a break-in", () => {
    const p = selectPolicyPath(
      { ...base, previousPolicyExpiryDate: "2026-07-01" },
      new Date("2026-07-24"),
    );
    expect(p.inceptionOffsetDays).toBe(3);
  });

  it("does not shift inception when there is no break-in", () => {
    const p = selectPolicyPath(
      { ...base, previousPolicyExpiryDate: "2026-08-01" },
      new Date("2026-07-24"),
    );
    expect(p.inceptionOffsetDays).toBe(0);
  });

  it("composes break-in onto a third-party policy", () => {
    const p = selectPolicyPath(
      { ...base, selectedPolicy: "thirdParty", previousPolicyExpiryDate: "2026-01-01" } as MotorQuoteRequest,
      new Date("2026-07-24"),
    );
    expect(p.zcover).toBe("AC");
    expect(p.breakIn).toBe(true);
    expect(p.breakInMoreThan90Days).toBe("Y");
  });
});

// ─── Code resolver ────────────────────────────────────────────────────────────

const repo = vi.hoisted(() => ({
  getProviderMmvCode: vi.fn(),
  getProviderRtoCode: vi.fn(),
  getProviderInsurerCode: vi.fn(),
}));
vi.mock("@/repositories/master.repository.ts", () => repo);

const { itgiDbCodeResolver } = await import("../db-code-resolver.ts");

const req = {
  vehicleType: "fourWheeler",
  makeId: "1",
  modelId: "10",
  makeName: "MARUTI",
  modelName: "SWIFT",
  fuelType: "petrol",
  rtoCode: "DL01",
} as unknown as MotorQuoteRequest;

beforeEach(() => {
  vi.clearAllMocks();
  repo.getProviderMmvCode.mockResolvedValue({ makeCode: "MARUTI", modelCode: "MRSFT" });
  repo.getProviderRtoCode.mockResolvedValue("DELHI");
  repo.getProviderInsurerCode.mockResolvedValue(undefined);
});

describe("itgi code resolver", () => {
  it("resolves the MMV variant code and RTO token", async () => {
    const codes = await itgiDbCodeResolver(req);
    expect(codes.makeCode).toBe("MRSFT");
    expect(codes.rtoCity).toBe("DELHI");
  });

  it("looks the RTO up for the vehicle's line", async () => {
    await itgiDbCodeResolver({ ...req, vehicleType: "twoWheeler" } as MotorQuoteRequest);
    expect(repo.getProviderRtoCode).toHaveBeenCalledWith("itgi", "DL01", "tw");
  });

  it("throws an unmapped-code error when the RTO has no ITGI mapping", async () => {
    repo.getProviderRtoCode.mockResolvedValue(undefined);
    await expect(itgiDbCodeResolver(req)).rejects.toThrow(ItgiUnmappedCodeError);
  });

  it("never derives an RTO token from the city name", async () => {
    // Strict by design: the vendor's RTO master is missing, so a miss must fail
    // closed rather than guess a token.
    repo.getProviderRtoCode.mockResolvedValue(undefined);
    await expect(itgiDbCodeResolver(req)).rejects.toThrow(/RTO mapping/i);
  });

  it("throws an unmapped-code error when the vehicle has no ITGI mapping", async () => {
    repo.getProviderMmvCode.mockResolvedValue(undefined);
    await expect(itgiDbCodeResolver(req)).rejects.toThrow(ItgiUnmappedCodeError);
  });
});
