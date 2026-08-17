import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CanonicalQuote } from "../vehicle/api/types";

/** Everything the certification cases need to vary, in one flat object. */
export interface HdfcConditions {
  // vehicle
  makeId: string; makeName: string; modelId: string; modelName: string;
  fuelType: string; engineCC?: number;
  rtoCode: string; registrationNumber: string; registrationDate: string;
  engineNumber: string; chassisNumber: string;
  // business
  businessType: "new" | "rollover";
  /** HDFC's Used Car product — a separate flag, not a business type. */
  isUsedVehiclePurchase: boolean;
  planType: string;
  tenureYears: number;
  idvValue?: number;
  paOwner: boolean;
  // previous policy
  previousInsurerId: string; previousInsurerName: string; previousPolicyNumber: string;
  previousPolicyStartDate?: string; previousPolicyExpiryDate?: string;
  isPreviousPolicyExpired: boolean;
  // previous TP (standalone OD only)
  previousTpPolicyNumber?: string; previousTpStartDate?: string; previousTpExpiryDate?: string;
  // ncb & claims
  ncbPercent: number; claimInPreviousPolicy: boolean;
  // accessories & bi-fuel
  electricalAccessoriesSI?: number; nonElectricalAccessoriesSI?: number;
  bifuelKitType?: string; bifuelKitSI?: number;
  unnamedPaSumInsured?: number;
}

export interface HdfcProposer {
  firstName: string; lastName: string; email: string; mobile: string;
  dob: string; gender: "M" | "F"; panNumber: string;
  addressLine1: string; addressLine2: string; pincode: string; city: string; state: string;
  nomineeName: string; nomineeRelation: string; nomineeAge: number;
}

/** One recorded vendor call, for the raw-exchange drawer. */
export interface HdfcExchange {
  step: string;
  at: string;
  request: unknown;
  response: unknown;
}

interface HdfcUatState {
  category: string | null;
  presetId: string | null;
  conditions: HdfcConditions | null;
  proposer: HdfcProposer;
  providerAddonCodes: string[];
  quote: CanonicalQuote | null;
  ckyc: string | null;
  kycRefId: string | null;
  proposal: CanonicalQuote | null;
  /** HDFC's own proposal number (`quoteNo` at issuance), from contractDetails. */
  proposalNumber: string | null;
  policyNo: string | null;
  exchanges: HdfcExchange[];

  setCategory: (c: string) => void;
  setPreset: (id: string | null) => void;
  setConditions: (c: HdfcConditions) => void;
  setProposer: (p: HdfcProposer) => void;
  setAddonCodes: (codes: string[]) => void;
  setQuote: (q: CanonicalQuote | null) => void;
  setCkyc: (ckyc: string | null, ref: string | null) => void;
  setProposal: (p: CanonicalQuote | null) => void;
  setProposalNumber: (n: string | null) => void;
  setPolicyNo: (n: string | null) => void;
  recordExchange: (e: HdfcExchange) => void;
  reset: () => void;
}

/**
 * A fictional proposer, deliberately so: a shared sandbox is not a place to put
 * a real person's PAN or address. It matches the identity the five scenarios in
 * `tf-api/scripts/hdfc-uat-issuance.ts` bound live, so a tester who changes
 * nothing walks the same path that is already proven.
 *
 * `nomineeRelation` is "Spouse" with a capital S on purpose. HDFC matches this
 * field against its RELATION MASTER CASE-SENSITIVELY, and a live CreateProposal
 * carrying "spouse" was rejected outright with "Please pass Nominee relationship
 * as per the shared master!" even though "Spouse" is in that list. The master is
 * `HDFC_RELATION_MASTER` in `tf-api/src/providers/hdfc/config.ts`.
 */
const DEFAULT_PROPOSER: HdfcProposer = {
  firstName: "Test", lastName: "User",
  email: "uat@example.com", mobile: "9999999999",
  dob: "1990-01-01", gender: "M", panNumber: "ABCPD1234E",
  addressLine1: "1 Test Street", addressLine2: "Andheri East",
  pincode: "400069", city: "Mumbai", state: "Maharashtra",
  nomineeName: "Test Nominee", nomineeRelation: "Spouse", nomineeAge: 30,
};

const initial = {
  category: null, presetId: null, conditions: null,
  proposer: DEFAULT_PROPOSER, providerAddonCodes: [] as string[],
  quote: null, ckyc: null, kycRefId: null, proposal: null,
  proposalNumber: null, policyNo: null, exchanges: [] as HdfcExchange[],
};

export const useHdfcUatStore = create<HdfcUatState>()(
  persist(
    (set) => ({
      ...initial,
      setCategory: (category) => set({ category }),
      setPreset: (presetId) => set({ presetId }),
      setConditions: (conditions) => set({ conditions }),
      setProposer: (proposer) => set({ proposer }),
      setAddonCodes: (providerAddonCodes) => set({ providerAddonCodes }),
      setQuote: (quote) => set({ quote }),
      setCkyc: (ckyc, kycRefId) => set({ ckyc, kycRefId }),
      setProposal: (proposal) => set({ proposal }),
      setProposalNumber: (proposalNumber) => set({ proposalNumber }),
      setPolicyNo: (policyNo) => set({ policyNo }),
      recordExchange: (e) => set((s) => ({ exchanges: [...s.exchanges, e] })),
      // Spread, don't hand back `initial` itself — its arrays are single shared
      // instances, so a future action that pushed in place would poison the
      // reset baseline for the life of the page.
      reset: () => set({ ...initial }),
    }),
    // A DIFFERENT storage key from FG's "fg-uat-journey" on purpose: the two
    // harnesses persist to the same localStorage origin, and sharing a key would
    // let one journey's conditions overwrite the other's mid-certification.
    { name: "hdfc-uat-journey" },
  ),
);

export { DEFAULT_PROPOSER };
