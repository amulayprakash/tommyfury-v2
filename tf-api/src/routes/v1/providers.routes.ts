import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { listProviders } from "@/providers/provider-registry.ts";
import { listMotorAddons } from "@/repositories/master.repository.ts";

const router = Router();

router.get("/providers", (_req, res) => {
  res.json({ status: "success", providers: listProviders() });
});

/** Normalise journey categories onto the two master add-on classes. */
function addonCategory(category: string): string {
  if (category === "newVehicle") return "fourWheeler";
  if (category === "newCommercial") return "commercial";
  return category;
}

// GET /providers/:provider/addons?category=fourWheeler&fuel=petrol
// Provider-specific add-on catalog (FG: from the master "Add On Covers" sheet).
router.get(
  "/providers/:provider/addons",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const qs = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
      const provider = qs(req.params.provider, "");
      const category = addonCategory(qs(req.query.category, "fourWheeler"));
      const fuelClass = qs(req.query.fuel, "") === "electric" ? "electric" : "standard";
      const rows = await listMotorAddons(provider, category, fuelClass);
      res.json({
        status: "success",
        addons: rows.map((a) => ({
          code: a.code,
          label: a.label,
          maxAgeYears: a.maxAgeYears,
          requiresZeroDep: a.requiresZeroDep,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

export { router as providersRouter };
