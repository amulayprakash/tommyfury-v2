import { Router } from "express";
import { handleRtoSearch, handleMmvSearch, handleInsurers } from "@/controllers/master.controller.ts";

const router = Router();

// Typeahead data for the journey forms (provider-agnostic canonical masters).
router.get("/masters/rto", handleRtoSearch);
router.get("/masters/mmv", handleMmvSearch);
router.get("/masters/insurers", handleInsurers);

export { router as mastersRouter };
