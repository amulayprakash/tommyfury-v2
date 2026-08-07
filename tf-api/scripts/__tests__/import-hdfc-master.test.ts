import { describe, it, expect } from "vitest";
import {
  normalizeHdfcFuel,
  normalizeName,
  parseRtoKey,
  parseModelRow,
  pickBestVariant,
} from "../import-hdfc-master.ts";

describe("normalizeHdfcFuel", () => {
  it("maps HDFC's fuel labels onto the canonical FuelType", () => {
    expect(normalizeHdfcFuel("PETROL")).toBe("petrol");
    expect(normalizeHdfcFuel("DIESEL")).toBe("diesel");
    expect(normalizeHdfcFuel("ELECTRIC")).toBe("electric");
    expect(normalizeHdfcFuel("CNG")).toBe("cng");
    expect(normalizeHdfcFuel("LPG")).toBe("lpg");
  });

  it("treats hybrid and battery variants correctly", () => {
    expect(normalizeHdfcFuel("PETROL HYBRID")).toBe("hybrid");
    expect(normalizeHdfcFuel("BATTERY")).toBe("electric");
  });

  it("defaults to petrol for an unrecognised label", () => {
    expect(normalizeHdfcFuel("")).toBe("petrol");
  });
});

describe("normalizeName", () => {
  it("upper-cases and collapses punctuation and spacing", () => {
    expect(normalizeName(" Maruti-Suzuki  India Ltd. ")).toBe("MARUTI SUZUKI INDIA LTD");
  });

  it("is stable for names that differ only in punctuation", () => {
    expect(normalizeName("MERCEDES-BENZ")).toBe(normalizeName("MERCEDES BENZ"));
  });
});

describe("parseRtoKey", () => {
  it("extracts state and number from HDFC's REGISTRATION_STATE_CITY", () => {
    expect(parseRtoKey("MH-1-MUMBAI")).toEqual({ stateCode: "MH", number: 1 });
    expect(parseRtoKey("JK-6-DODA")).toEqual({ stateCode: "JK", number: 6 });
  });

  it("handles a city name containing a dash", () => {
    expect(parseRtoKey("GJ-38-BAVLA-EAST")).toEqual({ stateCode: "GJ", number: 38 });
  });

  it("strips leading zeros from the number", () => {
    expect(parseRtoKey("MH-01-MUMBAI")).toEqual({ stateCode: "MH", number: 1 });
  });

  it("returns null for an unparseable value", () => {
    expect(parseRtoKey("")).toBeNull();
    expect(parseRtoKey("MUMBAI")).toBeNull();
  });
});

describe("parseModelRow", () => {
  it("parses a Model_Master row", () => {
    const row = parseModelRow({
      MANUFACTURER: "TATA MOTORS LTD",
      VEHICLEMODELCODE: 42774,
      VEHICLEMODEL: "NEXON EV",
      NUMBEROFWHEELS: 4,
      CUBICCAPACITY: 999,
      SEATINGCAPACITY: 5,
      TXT_FUEL: "ELECTRIC",
      TXT_VARIANT: "XZ PLUS",
    });
    expect(row).toEqual({
      make: "TATA MOTORS LTD",
      modelCode: "42774",
      model: "NEXON EV",
      variant: "XZ PLUS",
      fuelType: "electric",
      engineCC: 999,
      seatingCapacity: 5,
      wheels: 4,
    });
  });

  it("rejects a row with no model code", () => {
    expect(parseModelRow({ MANUFACTURER: "X", VEHICLEMODEL: "Y", TXT_FUEL: "PETROL" })).toBeNull();
  });

  it("rejects a non-four-wheeler row", () => {
    // HDFC is Private Car only; a two-wheeler row must not be cross-walked.
    expect(
      parseModelRow({
        MANUFACTURER: "HERO",
        VEHICLEMODELCODE: 1,
        VEHICLEMODEL: "SPLENDOR",
        NUMBEROFWHEELS: 2,
        TXT_FUEL: "PETROL",
      }),
    ).toBeNull();
  });
});

describe("pickBestVariant", () => {
  const candidates = [
    { modelCode: "A", variant: "VXI", engineCC: 1197 },
    { modelCode: "B", variant: "ZXI PLUS", engineCC: 1197 },
    { modelCode: "C", variant: "LXI", engineCC: 998 },
  ];

  it("prefers an exact variant-name match", () => {
    expect(pickBestVariant(candidates, "ZXI PLUS", 1197)?.modelCode).toBe("B");
  });

  it("falls back to matching engine capacity", () => {
    expect(pickBestVariant(candidates, "UNKNOWN TRIM", 998)?.modelCode).toBe("C");
  });

  it("falls back to the first candidate when nothing discriminates", () => {
    expect(pickBestVariant(candidates, undefined, undefined)?.modelCode).toBe("A");
  });

  it("returns undefined for an empty candidate list", () => {
    expect(pickBestVariant([], "VXI", 1197)).toBeUndefined();
  });
});
