/**
 * Seed scaffold — populate provider + master tables.
 * Run: npm run db:seed
 *
 * Master tables (rto_master, mmv_master, insurer_master) are seeded from the
 * live MySQL dumps (zuno_*) for FG, and ICICI's full UAT masters via
 * `npm run db:import:icici` (scripts/import-icici-master.ts). This seed keeps a
 * tiny dev subset (codes from the ICICI sample payloads) so the canonical →
 * provider-code pipeline and the test DB stay runnable without the full import.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ── Providers ──
  await prisma.provider.upsert({
    where: { slug: "icici" },
    update: { capabilities: ["fourWheeler", "twoWheeler"] },
    create: {
      slug: "icici",
      displayName: "ICICI Lombard",
      isActive: true,
      capabilities: ["fourWheeler", "twoWheeler"],
    },
  });

  // ── Dev master subset (ICICI sample codes) ──
  const rto = await prisma.rtoMaster.upsert({
    where: { code: "MH02" },
    update: { source: "fg" },
    create: { code: "MH02", city: "Mumbai", state: "Maharashtra", stateCode: "MH", source: "fg" },
  });
  // Line-aware ICICI RTO code (the sample vehicle below is fourWheeler → line "fw"),
  // matching the real import so a seeded-only dev DB resolves like a fully-imported one.
  await prisma.providerRtoCode.upsert({
    where: { providerSlug_rtoId_line: { providerSlug: "icici", rtoId: rto.id, line: "fw" } },
    update: { providerCode: "12621" },
    create: { providerSlug: "icici", rtoId: rto.id, providerCode: "12621", line: "fw" },
  });

  const mmv = await prisma.mmvMaster.upsert({
    where: {
      makeId_modelId_variantId_fuelType: {
        makeId: "10",
        modelId: "11846",
        variantId: "",
        fuelType: "petrol",
      },
    },
    update: { source: "icici" },
    create: {
      makeId: "10",
      makeName: "Sample Make",
      modelId: "11846",
      modelName: "Sample Model",
      variantId: "",
      variantName: "",
      fuelType: "petrol",
      category: "fourWheeler",
      source: "icici",
    },
  });
  await prisma.providerMmvCode.upsert({
    where: { providerSlug_mmvId: { providerSlug: "icici", mmvId: mmv.id } },
    update: { providerMakeCode: "10", providerModelCode: "11846" },
    create: {
      providerSlug: "icici",
      mmvId: mmv.id,
      providerMakeCode: "10",
      providerModelCode: "11846",
    },
  });

  const insurer = await prisma.insurerMaster.upsert({
    where: { code: "ICICI_LOMBARD" },
    update: { source: "fg" },
    create: { code: "ICICI_LOMBARD", name: "ICICI Lombard", shortName: "ICICI", source: "fg" },
  });
  await prisma.providerInsurerCode.upsert({
    where: { providerSlug_insurerId: { providerSlug: "icici", insurerId: insurer.id } },
    update: { providerCode: "ICICI LOMBARD" },
    create: { providerSlug: "icici", insurerId: insurer.id, providerCode: "ICICI LOMBARD" },
  });

  await prisma.provider.upsert({
    where: { slug: "fg" },
    update: { capabilities: ["fourWheeler", "commercial", "newCommercial"] },
    create: {
      slug: "fg",
      displayName: "Future Generali",
      isActive: true,
      capabilities: ["fourWheeler", "commercial", "newCommercial"],
    },
  });

  await seedHealthMasters();

  console.log("Seed complete.");
}

// ─── Health masters (FG is the master source) ─────────────────────────────────
// Dev subset that mirrors the mapper's built-in codes + product registry; the
// full field masters are loaded by `npm run db:import:health`.
async function seedHealthMasters() {
  const relations: Array<[string, string, string]> = [
    ["self", "Self", "SELF"],
    ["spouse", "Spouse", "SPOU"],
    ["father", "Father", "FATH"],
    ["mother", "Mother", "MOTH"],
    ["son", "Son", "SONM"],
    ["daughter", "Daughter", "DAUG"],
    ["brother", "Brother", "BROT"],
    ["sister", "Sister", "SIST"],
    ["grandfather", "Grandfather", "GRFA"],
    ["grandmother", "Grandmother", "GRMO"],
    ["fatherInLaw", "Father-in-law", "FILW"],
    ["motherInLaw", "Mother-in-law", "MILW"],
    ["other", "Other", "OTHR"],
  ];
  for (const [code, label, fgCode] of relations) {
    await prisma.healthRelationMaster.upsert({
      where: { code },
      update: { label, fgCode },
      create: { code, label, fgCode },
    });
  }

  const occupations: Array<[string, string, string | null]> = [
    ["SVCM", "Service / Salaried", null],
    ["HSWF", "Housewife", null],
    ["ACCT", "Accountant", "1"],
    ["AMEX", "Self-employed Professional", "1"],
    ["BUSN", "Business", "2"],
    ["STUD", "Student", null],
    ["RETD", "Retired", null],
    ["OTHR", "Other", "1"],
  ];
  for (const [code, description, paRiskClass] of occupations) {
    await prisma.healthOccupationMaster.upsert({
      where: { code },
      update: { description, fgCode: code, paRiskClass },
      create: { code, description, fgCode: code, paRiskClass },
    });
  }

  const products: Array<{
    code: string;
    label: string;
    line: string;
    fgProduct: string;
    fgMajorClass: string;
    fgContractType: string;
    fgPolicyType: string;
    covers: Array<[string, string]>;
  }> = [
    { code: "healthAbsolute", label: "FG Health Absolute", line: "indemnity", fgProduct: "HealthAbsolute", fgMajorClass: "FHA", fgContractType: "FHA", fgPolicyType: "HAI", covers: [["Classic", "Classic"], ["Premier", "Premier"], ["Elite", "Elite"]] },
    { code: "healthVital", label: "FG Health Vital", line: "indemnity", fgProduct: "HealthVital", fgMajorClass: "VIT", fgContractType: "VIT", fgPolicyType: "HVI", covers: [["Vital", "Vital"], ["Classic", "Classic"]] },
    { code: "healthTotal", label: "FG Health Total", line: "indemnity", fgProduct: "HealthTotal", fgMajorClass: "HTO", fgContractType: "HTO", fgPolicyType: "HTI", covers: [["VITAL", "Vital"], ["Superior", "Superior"]] },
    { code: "diy", label: "FG Health DIY", line: "indemnity", fgProduct: "DIY", fgMajorClass: "DIY", fgContractType: "DIY", fgPolicyType: "DYI", covers: [["Mini", "Mini"], ["Midi", "Midi"], ["Maxi", "Maxi"]] },
    { code: "advantageTopup", label: "Future Advantage Top-Up", line: "indemnity", fgProduct: "AdvantageTopup", fgMajorClass: "FAT", fgContractType: "FAT", fgPolicyType: "HTI", covers: [["Classic", "Classic"], ["Elite", "Elite"]] },
    { code: "varishtaBima", label: "Future Varishta Bima", line: "indemnity", fgProduct: "VarishtaBima", fgMajorClass: "FVB", fgContractType: "FVB", fgPolicyType: "VBI", covers: [["Bronze", "Bronze"], ["Silver", "Silver"], ["Gold", "Gold"]] },
    { code: "personalAccident", label: "Personal Accident", line: "pa", fgProduct: "PA", fgMajorClass: "PAC", fgContractType: "PAL", fgPolicyType: "", covers: [["AD", "Accidental Death"], ["PT", "Permanent Total Disability"], ["PP", "Permanent Partial Disability"], ["TTD", "Temporary Total Disability"], ["ME", "Medical Expenses"]] },
  ];
  for (const p of products) {
    await prisma.healthProductMaster.upsert({
      where: { code: p.code },
      update: { label: p.label, line: p.line, fgProduct: p.fgProduct, fgMajorClass: p.fgMajorClass, fgContractType: p.fgContractType, fgPolicyType: p.fgPolicyType },
      create: { code: p.code, label: p.label, line: p.line, fgProduct: p.fgProduct, fgMajorClass: p.fgMajorClass, fgContractType: p.fgContractType, fgPolicyType: p.fgPolicyType },
    });
    for (let i = 0; i < p.covers.length; i++) {
      const [coverCode, coverLabel] = p.covers[i]!;
      await prisma.healthCoverMaster.upsert({
        where: { productCode_code: { productCode: p.code, code: coverCode } },
        update: { label: coverLabel, sortOrder: i },
        create: { productCode: p.code, code: coverCode, label: coverLabel, sortOrder: i },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
