/**
 * Validates the ICICI cross-walk codes against the LIVE ICICI UAT premium API so the DB
 * only asserts coverage it actually has. For each ProviderMmvCode/ProviderRtoCode(icici)
 * it fires a minimal Save-Quote (make/model probed against a known-good RTO for its line;
 * RTO probed against a known-good make/model) and classifies the response:
 *   Success                     → set verifiedAt (good)
 *   "…not found"                → confirmed-bad   (verifyError; deleted by --cleanup)
 *   504 / null body / timeout /
 *   "Invalid token" / network   → transient       (verifyError; left for a re-run)
 * Only a DEFINITIVE not-found is ever deleted — never a transient failure.
 *
 *   npx tsx --env-file=.env scripts/validate-icici-codes.ts --what=mmv --line=fw --fallback --makes=Maruti,Hyundai
 *   npx tsx --env-file=.env scripts/validate-icici-codes.ts --what=mmv --ids=27354,49294 --fallback
 *   npx tsx --env-file=.env scripts/validate-icici-codes.ts --what=rto --line=fw --rtos=MH12,MH14
 *   npx tsx --env-file=.env scripts/validate-icici-codes.ts --cleanup          # delete confirmed-bad
 * Flags: --what=mmv|rto|both  --line=fw|tw  --limit=N  --resume (skip verifiedAt < N days)
 *        --rps=N (default 8)  --dry-run  --cleanup
 *        --makes=<csv>  MMV: canonical makeName contains any (first-run scoping)
 *        --ids=<csv>    MMV: exact canonical mmvId list
 *        --rtos=<csv>   RTO: canonical RtoMaster.code list (e.g. MH12,MH14)
 *        --fallback     MMV: on a bad stored code, probe ranked sidecar candidates, keep first that prices
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { loadIciciConfig } from "@/providers/icici/config.ts";
import { iciciTokenFetcher } from "@/providers/icici/auth.ts";

const prisma = new PrismaClient();
const cfg = loadIciciConfig();

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);
const what = arg("what") ?? "both";
const onlyLine = arg("line");
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const rps = Number(arg("rps") ?? 8);
const resumeDays = has("resume") ? 7 : 0;
const dryRun = has("dry-run");
const cleanup = has("cleanup");
// Subset filters (first-run scoping) + candidate fallback.
const makesArg = arg("makes"); // MMV: canonical makeName contains any of these (csv)
const idsArg = arg("ids"); //     MMV: exact canonical mmvId list (csv)
const rtosArg = arg("rtos"); //   RTO: canonical RtoMaster.code list (csv, e.g. MH12,MH14)
const fallback = has("fallback"); // MMV: on a bad/transient stored code, try ranked sidecar candidates
const makeList = makesArg ? makesArg.split(",").map((m) => m.trim().toUpperCase()).filter(Boolean) : [];
const idList = idsArg ? idsArg.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n)) : [];
const rtoList = rtosArg ? rtosArg.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : [];

/** Ranked ICICI make/model candidates per canonical mmvId (written by import-icici-master.ts). */
function loadSidecar(): Record<string, { makeCode: string; modelCode: string }[]> {
  try {
    return JSON.parse(readFileSync(`${import.meta.dirname}/_icici-mmv-candidates.json`, "utf8"));
  } catch {
    console.log("  (no _icici-mmv-candidates.json — run scripts/import-icici-master.ts first for --fallback)");
    return {};
  }
}

// Known-good anchors per line (confirmed live): probe make/model against a good RTO, and
// probe RTOs against a good make/model. ProductCode = rollover-comprehensive for the line.
const ANCHOR: Record<string, { product: number; rto: number; make: number; model: number; seg: string }> = {
  fw: { product: 21, rto: 2125, make: 13, model: 2046, seg: "motor-fw" }, // AUDI V6 @ Gujarat-Dharampur
  tw: { product: 13, rto: 634, make: 32, model: 21646, seg: "motor-tw" }, // Hero Splendor @ Pune
};
const lineForCategory = (c: string) => (c === "twoWheeler" ? "tw" : c === "commercial" ? "cv" : "fw");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let token = "";
async function refreshToken() { token = (await iciciTokenFetcher(cfg)()).accessToken; }

type Outcome = { kind: "good" | "bad" | "transient"; msg: string };
async function probe(line: string, makeCode: number, modelCode: number, rtoCode: number): Promise<Outcome> {
  const a = ANCHOR[line]!;
  const payload = {
    ProductCode: a.product, OwnerType: 1, MakeCode: makeCode, ModelCode: modelCode, RTOCode: rtoCode,
    RegistrationNo: "MH12AB1234", RegistrationDate: "2021-06-01", IDVType: 3, Addons: [],
    HasExistingPACover: false, PreviousPolicyClaimed: false, PreviousPolicyNcbPercentage: 0,
    PreviousInsurerCode: "", RequestId: `val-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, Pincode: "411001",
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/generic/${a.seg}/generic/premium`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 504 || res.status >= 500) return { kind: "transient", msg: `http ${res.status}` };
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (b.Success === true) return { kind: "good", msg: "" };
      const msg = String(b.ErrorMessage ?? b.DisplayMessage ?? `http ${res.status}`);
      if (/invalid token/i.test(msg)) { if (attempt === 1) { await refreshToken(); continue; } return { kind: "transient", msg }; }
      if (/not found/i.test(msg)) return { kind: "bad", msg }; // definitive: vehicle/make/RTO not found
      return { kind: "transient", msg: msg.slice(0, 120) }; // null-body / unprovisioned / other → don't delete
    } catch (e) {
      if (attempt === 2) return { kind: "transient", msg: (e as Error).message };
    }
  }
  return { kind: "transient", msg: "exhausted" };
}

async function validateMmv() {
  const since = resumeDays ? new Date(Date.now() - resumeDays * 864e5) : undefined;
  const mmvWhere = {
    ...(onlyLine ? { category: onlyLine === "tw" ? "twoWheeler" : onlyLine === "cv" ? "commercial" : "fourWheeler" } : {}),
    ...(makeList.length ? { OR: makeList.map((m) => ({ makeName: { contains: m } })) } : {}),
  };
  const rows = await prisma.providerMmvCode.findMany({
    where: {
      providerSlug: "icici",
      ...(since ? { OR: [{ verifiedAt: null }, { verifiedAt: { lt: since } }] } : {}),
      ...(idList.length ? { mmvId: { in: idList } } : {}),
      ...(Object.keys(mmvWhere).length ? { mmv: mmvWhere } : {}),
    },
    include: { mmv: { select: { category: true, makeName: true, modelName: true } } },
    take: limit,
  });
  const sidecar = fallback ? loadSidecar() : {};
  let good = 0, bad = 0, transient = 0, healed = 0;
  for (const r of rows) {
    const line = lineForCategory(r.mmv.category);
    if (!ANCHOR[line]) { continue; } // cv has no anchor yet
    const anchorRto = ANCHOR[line]!.rto;
    let o = await probe(line, Number(r.providerMakeCode), Number(r.providerModelCode), anchorRto);
    let chosen = { makeCode: r.providerMakeCode ?? "", modelCode: r.providerModelCode ?? "" };
    // Fallback: the stored (best-guess) code didn't price — walk the ranked candidates and
    // keep the FIRST that actually prices in UAT (self-heals a wrong-but-plausible match).
    if (o.kind !== "good" && fallback) {
      for (const c of sidecar[String(r.mmvId)] ?? []) {
        if (c.makeCode === chosen.makeCode && c.modelCode === chosen.modelCode) continue; // already tried
        await sleep(1000 / rps);
        const alt = await probe(line, Number(c.makeCode), Number(c.modelCode), anchorRto);
        if (alt.kind === "good") { o = alt; chosen = c; healed++; break; }
        if (alt.kind === "bad") o = alt; // remember a definitive not-found over a transient
      }
    }
    if (o.kind === "good") good++; else if (o.kind === "bad") bad++; else transient++;
    if (!dryRun) {
      await prisma.providerMmvCode.update({
        where: { id: r.id },
        data:
          o.kind === "good"
            ? { providerMakeCode: chosen.makeCode, providerModelCode: chosen.modelCode, verifiedAt: new Date(), verifyError: null }
            : { verifyError: `${o.kind}: ${o.msg}`.slice(0, 255) },
      });
    }
    await sleep(1000 / rps);
  }
  console.log(`MMV(${onlyLine ?? "all"}): good=${good} bad=${bad} transient=${transient} healed=${healed} of ${rows.length}`);
}

async function validateRto() {
  const since = resumeDays ? new Date(Date.now() - resumeDays * 864e5) : undefined;
  const rows = await prisma.providerRtoCode.findMany({
    where: {
      providerSlug: "icici", ...(onlyLine ? { line: onlyLine } : {}),
      ...(since ? { OR: [{ verifiedAt: null }, { verifiedAt: { lt: since } }] } : {}),
      ...(rtoList.length ? { rto: { code: { in: rtoList } } } : {}),
    },
    take: limit,
  });
  let good = 0, bad = 0, transient = 0;
  for (const r of rows) {
    const a = ANCHOR[r.line];
    if (!a) continue; // "all"/cv: no anchor
    const o = await probe(r.line, a.make, a.model, Number(r.providerCode));
    if (o.kind === "good") good++; else if (o.kind === "bad") bad++; else transient++;
    if (!dryRun) {
      await prisma.providerRtoCode.update({
        where: { id: r.id },
        data: o.kind === "good" ? { verifiedAt: new Date(), verifyError: null } : { verifyError: `${o.kind}: ${o.msg}`.slice(0, 255) },
      });
    }
    await sleep(1000 / rps);
  }
  console.log(`RTO(${onlyLine ?? "all"}): good=${good} bad=${bad} transient=${transient} of ${rows.length}`);
}

async function runCleanup() {
  // Delete ONLY rows whose last validation was a definitive "not found" (never transient).
  const badMmv = await prisma.providerMmvCode.deleteMany({ where: { providerSlug: "icici", verifyError: { startsWith: "bad:" } } });
  const badRto = await prisma.providerRtoCode.deleteMany({ where: { providerSlug: "icici", verifyError: { startsWith: "bad:" } } });
  console.log(`Cleanup: deleted ${badMmv.count} confirmed-bad ProviderMmvCode, ${badRto.count} ProviderRtoCode`);
}

async function main() {
  if (cleanup) { await runCleanup(); return; }
  console.log(`validate-icici-codes: what=${what} line=${onlyLine ?? "all"} limit=${limit ?? "∞"} rps=${rps} dryRun=${dryRun}`);
  await refreshToken();
  if (what === "mmv" || what === "both") await validateMmv();
  if (what === "rto" || what === "both") await validateRto();
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
