/**
 * Export all master / reference data from THIS machine's DB into a single
 * portable JSON file (prisma/data-snapshot.json).
 *
 *   npm run db:export
 *
 * Run this on the machine that already has the full data (after db:import:fg /
 * db:import:icici / db:import:health). Commit the resulting JSON. On any other
 * machine, `npm run db:import` recreates the exact same data with no Excel file
 * or MySQL CLI required.
 *
 * Transactional tables (quotes, health_quotes) are NOT exported.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { SNAPSHOT_TABLES, SNAPSHOT_PATH, delegate, type Snapshot } from "./data-snapshot.ts";

const prisma = new PrismaClient();

async function main() {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const t of SNAPSHOT_TABLES) {
    const rows = await delegate(prisma, t.model).findMany({ orderBy: { id: "asc" } });
    tables[t.key] = rows;
    counts[t.key] = rows.length;
    console.log(`  ${t.key.padEnd(22)} ${rows.length}`);
  }

  const snapshot: Snapshot = {
    exportedAt: new Date().toISOString(),
    counts,
    tables,
  };

  const out = resolve(process.cwd(), SNAPSHOT_PATH);
  writeFileSync(out, JSON.stringify(snapshot));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\nWrote ${total} rows → ${SNAPSHOT_PATH}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
