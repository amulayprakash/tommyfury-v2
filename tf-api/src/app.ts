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
import { healthInsuranceRouter } from "@/routes/v1/health-insurance.routes.ts";
import { createNivabupaRouter, createNivabupaProbeRouter } from "@/nivabupa/index.js";

// Register providers once at startup
import { registerIciciProvider } from "@/providers/icici/index.ts";
import { registerFgProvider } from "@/providers/fg/index.ts";
import { registerItgiProvider } from "@/providers/itgi/index.ts";
import { registerHdfcProvider } from "@/providers/hdfc/index.ts";

registerIciciProvider();
registerFgProvider();
registerItgiProvider();
registerHdfcProvider();

export function createApp(): express.Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // ── NivaBupa (Reassure 3.0) partner API ────────────────────────────────────
  // Mounted here, ahead of tf-api's CORS / rate-limit / body-parser stack, so
  // the eight NivaBupa pass-throughs keep the exact middleware chain they had as
  // a standalone service. The module carries its own CORS policy (its journey
  // endpoints use PATCH/PUT, which tf-api's CORS does not allow), its own body
  // parsers, and no rate limit (NivaBupa's gateway POSTs the payment callback
  // server-to-server — a 429 there means the buyer paid and got no confirmation).
  //
  // Every route and middleware inside is scoped to the `/nivabupa` prefix, so a
  // request to /api/v1/* passes straight through this router untouched.
  const nivabupaRouter = createNivabupaRouter();
  app.use(nivabupaRouter);
  // Compatibility alias: the ONDC backend served every route under /health too,
  // so a deployed frontend build whose base URL still ends in /health keeps
  // working without a rebuild.
  app.use("/health", nivabupaRouter);
  // GET /healthz, GET /readyz — NivaBupa's own probes. tf-api's equivalents stay
  // at /api/v1/healthz and /api/v1/readyz.
  app.use(createNivabupaProbeRouter());

  // CORS — in development reflect any origin (dev servers run on localhost,
  // 127.0.0.1, or LAN IPs interchangeably); production enforces the allow-list.
  app.use((req, res, next) => {
    // Chrome Private Network Access: a page on a LAN IP calling localhost
    // sends this preflight header and requires an explicit opt-in.
    if (env.NODE_ENV === "development" && req.headers["access-control-request-private-network"]) {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    next();
  });
  app.use(
    cors({
      origin: env.NODE_ENV === "development" ? true : env.ALLOWED_ORIGINS,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Signup-Id"],
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
  app.use("/api/v1", healthInsuranceRouter);
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
