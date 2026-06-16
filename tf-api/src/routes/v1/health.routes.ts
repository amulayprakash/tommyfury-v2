import { Router } from "express";
import { prisma } from "@/lib/prisma.ts";

const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get("/readyz", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "up", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", db: "down", timestamp: new Date().toISOString() });
  }
});

export { router as healthRouter };
