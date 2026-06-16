import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env.ts";

/** Shared Prisma client. Connects lazily on first query. */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
});

/** True when DB writes should be skipped (unit/integration tests run hermetically). */
export const persistenceDisabled = env.NODE_ENV === "test";
