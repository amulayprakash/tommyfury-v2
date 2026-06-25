/**
 * Imports the Future Generali Health "Field Masters" workbooks into the health
 * master tables (occupation / cover-plan / product codes + PA risk classes).
 *
 *   npm run db:import:health
 *
 * Idempotent (upserts). The seed (prisma/seed.ts) provides a working subset; this
 * loads the full occupation list and every product's plan/cover bands. Point at a
 * different kit with FG_HEALTH_MASTER_DIR. Missing workbooks are skipped with a log.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

const prisma = new PrismaClient();

const BASE_DIR =
  process.env.FG_HEALTH_MASTER_DIR ??
  "c:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/FG API Kit/FG API Kit/Health Master Updated/TCS_Health API KIT Latest/TCS_Health API KIT/OneDrive_2024-12-11/Health API Kit TCS";

/** canonical product → field-master workbook (relative to BASE_DIR). */
const PRODUCT_WORKBOOKS: Record<string, string> = {
  healthAbsolute: "Health Absolute/Field Masters for Health Absolute.xlsx",
  healthVital: "Health Vital/Health Vital/Field Masters for Health Vital.xlsx",
  advantageTopup: "FAT Adv Top Up/Field Masters for  Adv Top.xlsx",
  varishtaBima: "Varishta Bima/Field Masters for .xlsx",
  personalAccident: "PA Integration Kit/Field Masters for  PA.xlsx",
};

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const intOrNull = (v: unknown): number | null => {
  const n = Number(s(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && s(v) !== "" ? Math.round(n) : null;
};

type Row = Record<string, unknown>;
function sheet(wb: import("xlsx").WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  return ws ? (XLSX.utils.sheet_to_json(ws, { defval: "" }) as Row[]) : [];
}

async function upsertOccupation(code: string, description: string, paRiskClass: string | null) {
  if (!code) return;
  await prisma.healthOccupationMaster.upsert({
    where: { code },
    update: { description, fgCode: code, ...(paRiskClass ? { paRiskClass } : {}) },
    create: { code, description: description || code, fgCode: code, paRiskClass },
  });
}

async function main() {
  let occCount = 0;
  let coverCount = 0;

  for (const [product, rel] of Object.entries(PRODUCT_WORKBOOKS)) {
    const path = resolve(BASE_DIR, rel);
    if (!existsSync(path)) {
      console.warn(`skip ${product}: workbook not found (${rel})`);
      continue;
    }
    const wb = XLSX.readFile(path);

    // Occupations (shared catalog; union across products).
    for (const r of sheet(wb, "InsuredOccpn")) {
      await upsertOccupation(s(r["Occupation Code"]), s(r["Occupation Description"]), null);
      occCount++;
    }

    // Plan/cover bands → HealthCoverMaster.
    const planRows = sheet(wb, "Plan Details");
    let order = 0;
    for (const r of planRows) {
      const code = s(r["Plan Name"]);
      if (!code) continue;
      const siValues = Object.values(r).map(intOrNull).filter((n): n is number => n != null);
      const minSumInsured = siValues.length ? Math.min(...siValues) : null;
      const maxSumInsured = siValues.length ? Math.max(...siValues) : null;
      await prisma.healthCoverMaster.upsert({
        where: { productCode_code: { productCode: product, code } },
        update: { label: code, minSumInsured, maxSumInsured, sortOrder: order },
        create: { productCode: product, code, label: code, minSumInsured, maxSumInsured, sortOrder: order },
      });
      coverCount++;
      order++;
    }
  }

  // PA occupation risk classes (description-matched; no code column in this sheet).
  const paOccPath = resolve(BASE_DIR, "PA Integration Kit/PA Occupation master_Latest.xlsx");
  if (existsSync(paOccPath)) {
    const wb = XLSX.readFile(paOccPath);
    for (const r of sheet(wb, "Occupation master")) {
      const description = s(r["Occupation"]);
      const riskClass = s(r["Risk Class"]);
      if (!description) continue;
      await prisma.healthOccupationMaster.updateMany({
        where: { description },
        data: { paRiskClass: riskClass || null },
      });
    }
  }

  // PA cover codes (two groups: Main Covers + Additional Cover).
  const paCoverPath = resolve(BASE_DIR, "PA Integration Kit/PA cover code.xlsx");
  if (existsSync(paCoverPath)) {
    const wb = XLSX.readFile(paCoverPath);
    const ws = wb.Sheets[wb.SheetNames[0]!];
    const rows = ws
      ? (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][])
      : [];
    let order = 0;
    for (const row of rows.slice(1)) {
      const pairs = [
        [s(row[3]), s(row[4])], // Main Covers
        [s(row[0]), s(row[1])], // Additional Cover
      ];
      for (const [code, label] of pairs) {
        if (!code || code.toLowerCase() === "cover code") continue;
        await prisma.healthCoverMaster.upsert({
          where: { productCode_code: { productCode: "personalAccident", code } },
          update: { label: label || code, sortOrder: order },
          create: { productCode: "personalAccident", code, label: label || code, sortOrder: order },
        });
        coverCount++;
        order++;
      }
    }
  }

  console.log(`Health master import complete: ${occCount} occupation rows, ${coverCount} cover rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
