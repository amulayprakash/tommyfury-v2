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

/**
 * Picks the right RTO code for a vehicle `line` from a provider's (possibly per-line)
 * code rows. ICICI's RTO master is per-line — the same city has different codes for
 * 2W/4W/CV — so we store one row per line plus an optional line-agnostic "all" row.
 * Prefers the exact line, then "all". When `line` is given but neither exists, returns
 * undefined (honest miss — never a wrong-line code). When `line` is omitted, behaves
 * line-agnostically. Pure (no DB) so it is unit-testable.
 */
export function selectRtoCodeForLine(
  codes: { line: string; providerCode: string }[],
  line?: string,
): string | undefined {
  if (codes.length === 0) return undefined;
  if (line) {
    const match = codes.find((c) => c.line === line) ?? codes.find((c) => c.line === "all");
    return match?.providerCode;
  }
  return (codes.find((c) => c.line === "all") ?? codes[0])?.providerCode;
}

export async function getProviderRtoCode(
  providerSlug: string,
  rtoCode: string,
  line?: string,
): Promise<string | undefined> {
  const rto = await prisma.rtoMaster.findUnique({
    where: { code: rtoCode },
    include: { providerCodes: { where: { providerSlug } } },
  });
  return selectRtoCodeForLine(rto?.providerCodes ?? [], line);
}

export async function getProviderMmvCode(
  providerSlug: string,
  makeId: string,
  modelId: string,
  fuelType: string,
  variantId?: string,
): Promise<{ makeCode?: string | null; modelCode?: string | null } | undefined> {
  // The frontend's variant auto-pick can land on a variant row that has no provider
  // code even when a sibling variant of the same make/model/fuel does (provider codes
  // are model-grained, not variant-grained). Resolving across all sibling rows — and
  // preferring the exact requested variant only when it is itself coded — lets such a
  // vehicle still quote instead of failing NotFound (RT-06).
  const rows = await prisma.mmvMaster.findMany({
    where: { makeId, modelId, fuelType },
    include: { providerCodes: { where: { providerSlug } } },
  });
  const coded = rows.filter((r) => r.providerCodes[0]?.providerMakeCode && r.providerCodes[0]?.providerModelCode);
  if (coded.length === 0) return undefined;
  const exact = variantId ? coded.find((r) => r.variantId === variantId) : undefined;
  const code = (exact ?? coded[0]!).providerCodes[0]!;
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
