/**
 * HDFC's RELATION MASTER, duplicated from `HDFC_RELATION_MASTER` in
 * `tf-api/src/providers/hdfc/config.ts` — which stays the source of truth. tf-web
 * cannot import from tf-api (two separate npm projects with no shared package),
 * so the list is copied rather than shared; keep the two in step.
 *
 * The nominee relation is a `<select>` over this list and not a text box on
 * purpose. HDFC matches the field against the master CASE-SENSITIVELY: a live
 * CreateProposal carrying "spouse" was rejected with "Please pass Nominee
 * relationship as per the shared master!" while "Spouse" bound. Free text is a
 * way to lose a proposal to a lower-case S.
 *
 * "Police Holder" is HDFC's own misspelling of the policyholder and is reproduced
 * exactly — the master has no correctly-spelled entry, so "Policy Holder" is the
 * spelling that gets rejected.
 *
 * It lives in its own module rather than beside the field components because an
 * array export from a `.tsx` file breaks React Fast Refresh (and the lint rule
 * that guards it).
 */
export const HDFC_RELATION_MASTER = [
  "Brother",
  "Child",
  "Daughter",
  "Employee",
  "Father",
  "Father in law",
  "Grand Daughter",
  "Grand Father",
  "Grand Mother",
  "Grand Son",
  "Husband",
  "Mother",
  "Mother in law",
  "Partner",
  "Police Holder",
  "Sister",
  "Son",
  "Special concession adult",
  "Special concession child",
  "Wife",
  "Nephew",
  "Niece",
  "Uncle",
  "Spouse",
] as const;
