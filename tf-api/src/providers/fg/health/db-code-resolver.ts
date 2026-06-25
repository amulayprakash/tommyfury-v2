import { prisma } from "@/lib/prisma.ts";
import type { HealthProduct, MemberRelation } from "@/contracts/health/health-enums.ts";
import type { HealthMember } from "@/contracts/health/health-quote-request.ts";
import type { FgHealthResolvedCodes } from "./mapper.ts";

/** Minimal request shape the resolver needs (quote / proposal / issuance share it). */
export interface HealthResolveInput {
  product: HealthProduct;
  members: HealthMember[];
}

export type FgHealthCodeResolver = (req: HealthResolveInput) => Promise<FgHealthResolvedCodes>;

/**
 * Dev/fixtures resolver: the mapper's built-in RELATION_FG_CODE defaults and
 * occupation pass-through are used (no DB lookups).
 */
export const passthroughHealthResolver: FgHealthCodeResolver = async () => ({});

/**
 * Production resolver — overrides relation/occupation codes from the seeded health
 * masters (FG is the master source). PA cover names come from the cover master.
 * Empty masters degrade gracefully to the mapper defaults.
 */
export const dbHealthCodeResolver: FgHealthCodeResolver = async (req) => {
  const [relations, occupations] = await Promise.all([
    prisma.healthRelationMaster.findMany({ where: { isActive: true } }),
    prisma.healthOccupationMaster.findMany({ where: { isActive: true } }),
  ]);

  const relation: Partial<Record<MemberRelation, string>> = {};
  for (const r of relations) relation[r.code as MemberRelation] = r.fgCode;

  const occupation: Record<string, string> = {};
  for (const o of occupations) occupation[o.code] = o.fgCode;

  const resolved: FgHealthResolvedCodes = { relation, occupation };

  if (req.product === "personalAccident") {
    const covers = await prisma.healthCoverMaster.findMany({
      where: { productCode: "personalAccident", isActive: true },
    });
    resolved.paCoverNames = Object.fromEntries(covers.map((c) => [c.code, c.label]));
  }

  return resolved;
};
