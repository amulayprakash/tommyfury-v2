import { describe, it, expect } from "vitest";
import {
  normalizeItgiFuel,
  toItgiLine,
  parseMakeRow,
  normalizeName,
} from "../import-itgi-master.ts";

describe("itgi master import", () => {
  it("normalizes the vendor's inconsistent fuel labels", () => {
    expect(normalizeItgiFuel("BATTERY")).toBe("electric");
    expect(normalizeItgiFuel("Electric")).toBe("electric");
    expect(normalizeItgiFuel("HYBRID")).toBe("hybrid");
    expect(normalizeItgiFuel("Hybrid Electric")).toBe("hybrid");
    expect(normalizeItgiFuel("Petrol + CNG")).toBe("cng");
    expect(normalizeItgiFuel("Diesel")).toBe("diesel");
    expect(normalizeItgiFuel("LPG")).toBe("lpg");
    expect(normalizeItgiFuel("Petrol")).toBe("petrol");
  });

  it("maps the contract type to a vehicle line", () => {
    expect(toItgiLine("PCP")).toBe("fw");
    expect(toItgiLine("TWP")).toBe("tw");
    expect(toItgiLine(" twp ")).toBe("tw");
  });

  it("parses a MAKE sheet row into an importable record", () => {
    expect(
      parseMakeRow({
        MAKE: "KNE6PZ",
        MANUFACTURE: "KAWASAKI",
        MODEL: "NINJA",
        VARIANT: "KAWASAKI NINJA ER 6N",
        CC: "649",
        SEATING_CAPACITY: "2",
        FUEL_TYPE: "Petrol",
        CONTRACT_TYPE: "TWP",
      }),
    ).toEqual({
      variantCode: "KNE6PZ",
      make: "KAWASAKI",
      model: "NINJA",
      variant: "KAWASAKI NINJA ER 6N",
      engineCC: 649,
      seatingCapacity: 2,
      fuelType: "petrol",
      line: "tw",
    });
  });

  it("skips a row with no MAKE code", () => {
    expect(parseMakeRow({ MAKE: "", MANUFACTURE: "X" })).toBeNull();
  });

  it("tolerates missing numeric columns", () => {
    const row = parseMakeRow({ MAKE: "X1", MANUFACTURE: "A", MODEL: "B", CONTRACT_TYPE: "PCP" });
    expect(row?.engineCC).toBe(0);
    expect(row?.seatingCapacity).toBe(0);
  });

  it("normalizes names for fuzzy cross-walk matching", () => {
    expect(normalizeName("Maruti Suzuki")).toBe("MARUTISUZUKI");
    expect(normalizeName("MAHINDRA & MAHINDRA")).toBe("MAHINDRAANDMAHINDRA");
    expect(normalizeName("i20 Active")).toBe("I20ACTIVE");
  });
});
