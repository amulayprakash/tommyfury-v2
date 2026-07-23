import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

// Vitest sets DATABASE_URL → tf_api_test (vitest.config.ts), so this reads the TEST DB.
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });

/**
 * Expected counts after `import-fg-master.ts` runs from the NEW JSON-kit workbook against
 * a freshly-migrated tf_api_test. Numbers are derived from the workbook by replaying the
 * importer's de-dup/filter rules (see docs/superpowers/plans/2026-07-22-fg-masters-reimport-verification.md).
 * MMV/RTO use the isActive+source guard so a stale prior import can't skew them.
 */
describe("FG master import row counts (tf_api_test)", () => {
  it("MmvMaster(fg) active rows = 20310", async () => {
    expect(await prisma.mmvMaster.count({ where: { source: "fg", isActive: true } })).toBe(20310);
  });

  it("RtoMaster(fg) active rows = 1535", async () => {
    expect(await prisma.rtoMaster.count({ where: { source: "fg", isActive: true } })).toBe(1535);
  });

  it("OccupationMaster rows = 140", async () => {
    expect(await prisma.occupationMaster.count()).toBe(140);
  });

  it("InsurerMaster(fg) rows = 24 (TP Policy Insurer ClientCodes)", async () => {
    expect(await prisma.insurerMaster.count({ where: { source: "fg" } })).toBe(24);
  });

  it("MotorAddon(fg) rows = 17 (AT10K/AT20K excluded by the /^[A-Z]{4,6}$/ regex)", async () => {
    expect(await prisma.motorAddon.count({ where: { providerSlug: "fg" } })).toBe(17);
  });

  it("PincodeMaster rows = 168011", async () => {
    expect(await prisma.pincodeMaster.count()).toBe(168011);
  });

  it("spot-checks known PASIA_CODEs (modelId) resolve to the right make/model", async () => {
    const audi = await prisma.mmvMaster.findFirst({ where: { modelId: "AU0229" } });
    expect(audi?.makeName).toBe("AUDI");
    expect(audi?.modelName).toBe("A4");

    expect(await prisma.mmvMaster.findFirst({ where: { modelId: "BM0202" } })).not.toBeNull();

    const alfa = await prisma.mmvMaster.findFirst({ where: { modelId: "AF0001" } });
    expect(alfa?.makeName).toBe("ALFA ROMEO");
  });
});
