/**
 * Extracts request bodies from the HDFC Private Car Postman collection into
 * JSON fixtures used as golden payloads by the mapper tests.
 *
 *   npx tsx scripts/extract-hdfc-collection.ts
 *
 * The fixtures are committed: they are the contract the ported mapper is held
 * to, and regenerating them must be a deliberate, reviewable act.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KIT_DIR =
  process.env.HDFC_KIT_DIR ??
  "C:/Users/ASUS/Desktop/QUAGNITIA/dock boyz/HDFC API KIT/HDFC API KIT";
const COLLECTION = "Private Car.postman_collection.json";
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

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: { body?: { raw?: string } };
}

function walk(items: PostmanItem[], trail: string[], out: Map<string, unknown>): void {
  for (const it of items) {
    const t = [...trail, it.name];
    if (it.item) {
      walk(it.item, t, out);
      continue;
    }
    const key = t.join("/");
    const file = WANTED[key];
    if (!file) continue;
    const raw = it.request?.body?.raw;
    if (!raw) continue;
    out.set(file, JSON.parse(raw));
  }
}

const path = join(KIT_DIR, COLLECTION);
if (!existsSync(path)) {
  console.error(`HDFC collection not found at:\n  ${path}`);
  console.error("Set HDFC_KIT_DIR to the kit folder.");
  process.exit(1);
}

const collection = JSON.parse(readFileSync(path, "utf8")) as { item: PostmanItem[] };
const extracted = new Map<string, unknown>();
walk(collection.item, [], extracted);

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, body] of extracted) {
  writeFileSync(join(OUT_DIR, file), JSON.stringify(body, null, 2) + "\n", "utf8");
  console.log(`wrote ${OUT_DIR}/${file}`);
}

const missing = Object.values(WANTED).filter((f) => !extracted.has(f));
if (missing.length) {
  console.error(`\nMissing from the collection: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`\n${extracted.size} fixtures extracted.`);
