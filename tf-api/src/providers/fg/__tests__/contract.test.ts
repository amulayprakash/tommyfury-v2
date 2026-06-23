import { describe, it, expect } from "vitest";
import { resolveContract } from "../config.ts";

/**
 * Locks the ContractType/RiskType matrix to the master "Contract Type" sheet
 * (Motor field Master.xls) so the F13-vs-F33 ambiguity stays resolved.
 */
describe("resolveContract — master Contract Type matrix", () => {
  it("Private Car Annual (rollover, comprehensive) → FPV/FPV, 1yr, CO", () => {
    const r = resolveContract({
      vehicleType: "fourWheeler",
      selectedPolicy: "comprehensive",
      businessType: "rollover",
    });
    expect(r).toMatchObject({ contractType: "FPV", riskType: "FPV", cover: "CO", tenureYears: 1 });
  });

  it("Private Car Bundled New Vehicle → F13/F13, 3yr, CO", () => {
    const r = resolveContract({
      vehicleType: "fourWheeler",
      selectedPolicy: "comprehensive",
      businessType: "new",
    });
    expect(r).toMatchObject({ contractType: "F13", riskType: "F13", cover: "CO", tenureYears: 3 });
  });

  it("Private Car Standalone OD → FVO/FVO, OD", () => {
    const r = resolveContract({
      vehicleType: "fourWheeler",
      selectedPolicy: "standAloneOD",
      businessType: "rollover",
    });
    expect(r).toMatchObject({ contractType: "FVO", riskType: "FVO", cover: "OD" });
  });

  it("Private Car Third Party → FPV/FPV, LO", () => {
    const r = resolveContract({
      vehicleType: "fourWheeler",
      selectedPolicy: "thirdParty",
      businessType: "rollover",
    });
    expect(r).toMatchObject({ contractType: "FPV", riskType: "FPV", cover: "LO" });
  });

  it("Goods Carrying (GCV) → FCV/FGV", () => {
    const r = resolveContract({
      vehicleType: "commercial",
      selectedPolicy: "comprehensive",
      businessType: "rollover",
      commercialSubType: "goods",
    });
    expect(r).toMatchObject({ contractType: "FCV", riskType: "FGV", cover: "CO" });
  });

  it("Passenger Carrying (PCV) → FCV/FPC", () => {
    const r = resolveContract({
      vehicleType: "commercial",
      selectedPolicy: "comprehensive",
      businessType: "rollover",
      commercialSubType: "passenger",
    });
    expect(r).toMatchObject({ contractType: "FCV", riskType: "FPC", cover: "CO" });
  });
});
