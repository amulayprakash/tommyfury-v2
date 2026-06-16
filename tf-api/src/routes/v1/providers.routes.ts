import { Router } from "express";
import { listProviders } from "@/providers/provider-registry.ts";

const router = Router();

router.get("/providers", (_req, res) => {
  res.json({ status: "success", providers: listProviders() });
});

export { router as providersRouter };
