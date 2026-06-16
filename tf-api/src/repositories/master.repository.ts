import { prisma } from "@/lib/prisma.ts";

// ─── Typeahead reads (back the /masters endpoints) ────────────────────────────

export function searchRto(q: string, limit = 20) {
  return prisma.rtoMaster.findMany({
    where: {
      isActive: true,
      ...(q ? { OR: [{ code: { contains: q } }, { city: { contains: q } }] } : {}),
    },
    take: limit,
    orderBy: { city: "asc" },
  });
}

export function searchMmv(
  params: { make?: string; model?: string; category?: string },
  limit = 20,
) {
  return prisma.mmvMaster.findMany({
    where: {
      isActive: true,
      ...(params.category ? { category: params.category } : {}),
      ...(params.make ? { makeName: { contains: params.make } } : {}),
      ...(params.model ? { modelName: { contains: params.model } } : {}),
    },
    take: limit,
    orderBy: [{ makeName: "asc" }, { modelName: "asc" }],
  });
}

export function listInsurers() {
  return prisma.insurerMaster.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

// ─── Canonical → provider code resolution ─────────────────────────────────────

export async function getProviderRtoCode(
  providerSlug: string,
  rtoCode: string,
): Promise<string | undefined> {
  const rto = await prisma.rtoMaster.findUnique({
    where: { code: rtoCode },
    include: { providerCodes: { where: { providerSlug } } },
  });
  return rto?.providerCodes[0]?.providerCode;
}

export async function getProviderMmvCode(
  providerSlug: string,
  makeId: string,
  modelId: string,
  fuelType: string,
  variantId?: string,
): Promise<{ makeCode?: string | null; modelCode?: string | null } | undefined> {
  const mmv = await prisma.mmvMaster.findFirst({
    where: { makeId, modelId, fuelType, ...(variantId ? { variantId } : {}) },
    include: { providerCodes: { where: { providerSlug } } },
  });
  const code = mmv?.providerCodes[0];
  if (!code) return undefined;
  return { makeCode: code.providerMakeCode, modelCode: code.providerModelCode };
}

export async function getProviderInsurerCode(
  providerSlug: string,
  insurerCode: string,
): Promise<string | undefined> {
  const insurer = await prisma.insurerMaster.findUnique({
    where: { code: insurerCode },
    include: { providerCodes: { where: { providerSlug } } },
  });
  return insurer?.providerCodes[0]?.providerCode;
}
