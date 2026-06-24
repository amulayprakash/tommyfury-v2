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
    update: {},
    create: { code: "MH02", city: "Mumbai", state: "Maharashtra", stateCode: "MH" },
  });
  await prisma.providerRtoCode.upsert({
    where: { providerSlug_rtoId: { providerSlug: "icici", rtoId: rto.id } },
    update: { providerCode: "12621" },
    create: { providerSlug: "icici", rtoId: rto.id, providerCode: "12621" },
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
    update: {},
    create: {
      makeId: "10",
      makeName: "Sample Make",
      modelId: "11846",
      modelName: "Sample Model",
      variantId: "",
      variantName: "",
      fuelType: "petrol",
      category: "fourWheeler",
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
    update: {},
    create: { code: "ICICI_LOMBARD", name: "ICICI Lombard", shortName: "ICICI" },
  });
  await prisma.providerInsurerCode.upsert({
    where: { providerSlug_insurerId: { providerSlug: "icici", insurerId: insurer.id } },
    update: { providerCode: "ICICI LOMBARD" },
    create: { providerSlug: "icici", insurerId: insurer.id, providerCode: "ICICI LOMBARD" },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
