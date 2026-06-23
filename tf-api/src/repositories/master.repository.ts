import { prisma } from "@/lib/prisma.ts";

// ─── Insurer name → FG code (PreviousTPInsDtls for standalone OD) ──────────────
const INS_STOP = new Set([
  "GENERAL", "INSURANCE", "INSURANCE.", "CO", "CO.", "LTD", "LTD.", "LIMITED", "COMPANY",
  "INDIA", "THE", "AND", "ASSURANCE", "GIC", "INS",
]);
function insurerTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !INS_STOP.has(t));
}

/** Fuzzy-matches an RC insurer name to a seeded FG insurer ClientCode (numeric). */
export async function findFgInsurerCodeByName(name: string): Promise<string | undefined> {
  const tokens = insurerTokens(name);
  if (tokens.length === 0) return undefined;
  const insurers = (await prisma.insurerMaster.findMany({ where: { isActive: true } })).filter((i) =>
    /^\d+$/.test(i.code),
  );
  let best: { code: string; score: number } | undefined;
  for (const ins of insurers) {
    const set = new Set(insurerTokens(ins.name));
    const score = tokens.filter((t) => set.has(t)).length;
    if (score > 0 && (!best || score > best.score)) best = { code: ins.code, score };
  }
  return best?.code;
}

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

/**
 * Full MMV row (FG reads make/modelCode/body/cc/gvw/seating directly off this).
 * The provider model id (PASIA_CODE) is the authority and is unique, so match on
 * make+model and fall back to model alone — fuel is taken from the matched row,
 * avoiding a spurious "not found" when the RC fuel differs from the variant.
 */
export async function findMmvRow(makeId: string, modelId: string, _fuelType?: string) {
  return (
    (await prisma.mmvMaster.findFirst({ where: { makeId, modelId } })) ??
    (await prisma.mmvMaster.findFirst({ where: { modelId } }))
  );
}

/** RTO row by canonical code (carries the derived motor zone). */
export function getRtoByCode(code: string) {
  return prisma.rtoMaster.findUnique({ where: { code } });
}

/** Provider add-on catalog for a vehicle class (FG: from the master sheet). */
export function listMotorAddons(providerSlug: string, category: string, fuelClass = "standard") {
  return prisma.motorAddon.findMany({
    where: { providerSlug, category, fuelClass, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
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
