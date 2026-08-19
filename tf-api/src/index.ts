import { createApp } from "@/app.ts";
import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { prisma } from "@/lib/prisma.ts";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "tf-api started");
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutdown signal received");
  server.close(() => {
    void prisma.$disconnect().finally(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
  });
  // Force exit after 10s if connections remain
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
