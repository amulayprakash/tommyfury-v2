import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";

import { env } from "@/config/env.ts";
import { logger } from "@/lib/logger.ts";
import { requestIdMiddleware } from "@/lib/request-id.ts";
import { errorHandler } from "@/middleware/error-handler.ts";
import { healthRouter } from "@/routes/v1/health.routes.ts";
import { compareRouter } from "@/routes/v1/compare.routes.ts";
import { quotesRouter } from "@/routes/v1/quotes.routes.ts";
import { lifecycleRouter } from "@/routes/v1/lifecycle.routes.ts";
import { mastersRouter } from "@/routes/v1/masters.routes.ts";
import { providersRouter } from "@/routes/v1/providers.routes.ts";

// Register providers once at startup
import { registerProvider } from "@/providers/provider-registry.ts";
import { MockProvider } from "@/providers/mock/mock.provider.ts";
import { registerIciciProvider } from "@/providers/icici/index.ts";

if (env.MOCK_PROVIDER_ENABLED) {
  registerProvider(new MockProvider());
}
registerIciciProvider();

export function createApp(): express.Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS
  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      credentials: true,
    }),
  );

  // Rate limiting
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Request ID (must come before pino-http so it's in log context)
  app.use(requestIdMiddleware);

  // Structured request logging
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId,
      customLogLevel: (_req, res) => (res.statusCode >= 500 ? "error" : "info"),
    }),
  );

  // Parse JSON
  app.use(express.json({ limit: "512kb" }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use("/api/v1", healthRouter);
  app.use("/api/v1", compareRouter);
  app.use("/api/v1", quotesRouter);
  app.use("/api/v1", lifecycleRouter);
  app.use("/api/v1", mastersRouter);
  app.use("/api/v1", providersRouter);

  // 404
  app.use((_req, res) => {
    res.status(404).json({ status: "error", message: "Route not found" });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
