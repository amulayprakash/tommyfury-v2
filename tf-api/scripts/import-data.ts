/**
 * Import the portable data snapshot (prisma/data-snapshot.json) into THIS
 * machine's DB. Recreates every master / reference row exactly as exported,
 * preserving primary keys so the provider-code → master FK links stay intact.
 *
 *   npm run db:import
 *
 * Idempotent: wipes the snapshot tables and re-inserts. Requires migrations to
 * have run first (npm run db:migrate). Does NOT touch quotes / health_quotes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { SNAPSHOT_TABLES, SNAPSHOT_PATH, delegate, type Snapshot } from "./data-snapshot.ts";

const prisma = new PrismaClient();
const BATCH = 1000;

/** Drop auto-managed timestamp columns so DB defaults regenerate them. */
function clean(row: Record<string, unknown>): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, ...rest } = row;
  return rest;
}

async function main() {
  const file = resolve(process.cwd(), SNAPSHOT_PATH);
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  console.log(`Loaded snapshot exported ${snapshot.exportedAt}\n`);

  // FK checks off so we can truncate parents and reload in one pass.
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  try {
    // Delete children → parents (reverse of the insert order).
    for (const t of [...SNAPSHOT_TABLES].reverse()) {
      await delegate(prisma, t.model).deleteMany({});
    }

    // Insert parents → children.
    for (const t of SNAPSHOT_TABLES) {
      const rows = (snapshot.tables[t.key] ?? []) as Record<string, unknown>[];
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH).map(clean);
        if (chunk.length === 0) continue;
        const res = await delegate(prisma, t.model).createMany({ data: chunk });
        inserted += res.count;
      }
      console.log(`  ${t.key.padEnd(22)} ${inserted}`);
    }
  } finally {
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  }

  console.log("\nImport complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
