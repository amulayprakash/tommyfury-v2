/**
 * Extracts request bodies from the HDFC Private Car Postman collections into
 * JSON fixtures used as golden payloads by the mapper tests.
 *
 *   npx tsx scripts/extract-hdfc-collection.ts
 *
 * The fixtures are committed: they are the contract the ported mapper is held
 * to, and regenerating them must be a deliberate, reviewable act.
 *
 * THE KIT SHIPS TWO COLLECTIONS and they are not the same document:
 *
 *   Private Car.postman_collection.json  — the older one. Flat
 *     Comprehensive/{New Business,Roll Over,Used Vehicle} folders, no SA_OD
 *     anywhere. Its three CalculatePremium samples are the golden Policy_Details
 *     key sets the mapper's parity tests assert against.
 *
 *   Private Car_New.postman_collection   — the newer one (no .json suffix).
 *     Adds Comprehensive/New Business/{OD Plus TP,SA_OD} and
 *     Comprehensive/Roll Over/{OD Plus TP,SA_OD}. It is the ONLY place in the
 *     kit that shows what a standalone-OD payload looks like, and the only
 *     evidence for how a multi-year OD term is expressed.
 *
 * Both are extracted here, into the same directory, under distinct filenames:
 * the older collection's fixtures keep their existing names, the newer one's
 * SA_OD samples are prefixed `saod-`. Nothing is overwritten across the two.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KIT_DIR =
  process.env.HDFC_KIT_DIR ??
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/HDFC API KIT/HDFC API KIT";
const OUT_DIR = "src/providers/hdfc/fixtures/collection";

/** Postman folder trail → fixture filename. Only the steps we assert on. */
const WANTED: Record<string, string> = {
  "Comprehensive/New Business/02 GetCalculateIDV": "new-idv.json",
  "Comprehensive/New Business/03 CalculatePremium": "new-premium.json",
  "Comprehensive/New Business/04 CreateProposal": "new-proposal.json",
  "Comprehensive/New Business/06 SubmitPaymentDetails": "new-payment.json",
  "Comprehensive/Roll Over/02 GetCalculateIDV": "rollover-idv.json",
  "Comprehensive/Roll Over/03 CalculatePremium": "rollover-premium.json",
  "Comprehensive/Roll Over/04 CreateProposal": "rollover-proposal.json",
  "Comprehensive/Used Vehicle/03 CalculatePremium": "used-premium.json",
  "Comprehensive/Used Vehicle/04 CreateProposal": "used-proposal.json",
  "Liability/02 CalculatePremium": "liability-premium.json",
  "Renewal/02 RenewalExtract": "renewal-extract.json",
  "Renewal/04 CalculatePremium": "renewal-premium.json",
  "Renewal/05 CreateProposal": "renewal-proposal.json",
};

/**
 * The standalone-OD samples, which exist ONLY in the newer collection.
 *
 * All four terms are taken, not just the multi-year one, because the point of
 * these fixtures is the CONTRAST: every one of them sends POLICY_TENURE: 1 and
 * differs only in Policy_Details.PolicyEndDate. A single 3-year sample would
 * not prove that the tenure field is inert.
 *
 * Note the doubled bracket in the Roll Over long-term folder name — that typo
 * is HDFC's, and matching it exactly is what makes this extraction reproducible.
 */
const WANTED_NEW: Record<string, string> = {
  "Comprehensive/New Business/SA_OD/3 years/02 GetCalculateIDV": "saod-new-idv.json",
  "Comprehensive/New Business/SA_OD/3 years/03 CalculatePremium": "saod-new-premium.json",
  "Comprehensive/New Business/SA_OD/3 years/04 CreateProposal": "saod-new-proposal.json",
  "Comprehensive/Roll Over/SA_OD/Short Term(<1 year)/03 CalculatePremium":
    "saod-rollover-premium-short.json",
  "Comprehensive/Roll Over/SA_OD/1 year/03 CalculatePremium": "saod-rollover-premium-1y.json",
  "Comprehensive/Roll Over/SA_OD/Long Term(>1 year & < 3 years))/03 CalculatePremium":
    "saod-rollover-premium-long.json",
  "Comprehensive/Roll Over/SA_OD/Long Term(>1 year & < 3 years))/04 CreateProposal":
    "saod-rollover-proposal-long.json",
  // The comprehensive Roll Over sample from the SAME collection, as the control:
  // it is 1-year OD Plus TP and it, too, carries PolicyEndDate — which is why
  // the key's presence alone cannot be the multi-year signal (see below).
  "Comprehensive/Roll Over/OD Plus TP/03 CalculatePremium": "saod-rollover-control-premium.json",
};

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: { body?: { raw?: string } };
}

function walk(
  items: PostmanItem[],
  trail: string[],
  wanted: Record<string, string>,
  out: Map<string, unknown>,
): void {
  for (const it of items) {
    const t = [...trail, it.name];
    if (it.item) {
      walk(it.item, t, wanted, out);
      continue;
    }
    const file = wanted[t.join("/")];
    if (!file) continue;
    const raw = it.request?.body?.raw;
    if (!raw) continue;
    out.set(file, JSON.parse(raw));
  }
}

function extract(collectionFile: string, wanted: Record<string, string>): number {
  const path = join(KIT_DIR, collectionFile);
  if (!existsSync(path)) {
    console.error(`HDFC collection not found at:\n  ${path}`);
    console.error("Set HDFC_KIT_DIR to the kit folder.");
    process.exit(1);
  }

  const collection = JSON.parse(readFileSync(path, "utf8")) as { item: PostmanItem[] };
  const extracted = new Map<string, unknown>();
  walk(collection.item, [], wanted, extracted);

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, body] of extracted) {
    writeFileSync(join(OUT_DIR, file), JSON.stringify(body, null, 2) + "\n", "utf8");
    console.log(`wrote ${OUT_DIR}/${file}`);
  }

  const missing = Object.values(wanted).filter((f) => !extracted.has(f));
  if (missing.length) {
    console.error(`\nMissing from ${collectionFile}: ${missing.join(", ")}`);
    process.exit(1);
  }
  return extracted.size;
}

const total =
  extract("Private Car.postman_collection.json", WANTED) +
  extract("Private Car_New.postman_collection", WANTED_NEW);

console.log(`\n${total} fixtures extracted.`);
