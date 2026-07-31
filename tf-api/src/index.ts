import { createApp } from "@/app.ts";
import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { prisma } from "@/lib/prisma.ts";
import { startNivabupa, stopNivabupa } from "@/nivabupa/index.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "tf-api started");

  // Verifies the NivaBupa MySQL connection and starts its stale-journey sweeper.
  // Never rejects — an unreachable database degrades journey persistence without
  // taking the NivaBupa pass-through endpoints (or anything else) down with it.
  void startNivabupa();
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutdown signal received");
  server.close(() => {
    // NivaBupa's pool is drained before Prisma's client: a transaction killed
    // mid-commit could leave a journey pointing at a step whose rows are
    // half-written, which is the one state resume cannot recover from.
    void stopNivabupa()
      .catch(() => undefined)
      .then(() => prisma.$disconnect())
      .finally(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
  });
  // Force exit after 10s if connections remain
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
