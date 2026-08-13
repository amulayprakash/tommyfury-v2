import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CanonicalQuote } from "../vehicle/api/types";

/** Everything the certification cases need to vary, in one flat object. */
export interface FgConditions {
  // vehicle
  makeId: string; makeName: string; modelId: string; modelName: string;
  variantId?: string; variantName?: string;
  fuelType: string; engineCC?: number;
  rtoCode: string; registrationNumber: string; registrationDate: string;
  engineNumber: string; chassisNumber: string;
  // business
  businessType: "new" | "rollover" | "renewal";
  planType: string;
  idvValue?: number;
  // previous policy
  previousInsurerName: string; previousPolicyNumber: string;
  previousPolicyStartDate?: string; previousPolicyExpiryDate?: string;
  isPreviousPolicyExpired: boolean;
  // previous TP (standalone OD only)
  previousTpPolicyNumber?: string; previousTpStartDate?: string; previousTpExpiryDate?: string;
  // ncb & claims
  ncbPercent: number; claimInPreviousPolicy: boolean;
  // break-in
  inspectionReportNumber?: string; inspectionDate?: string;
  // commercial only
  commercialSubType?: "goods" | "passenger";
  grossVehicleWeight?: number; seatingCapacity?: number; carryingCapacity?: number;
}

export interface FgProposer {
  firstName: string; lastName: string; email: string; mobile: string;
  dob: string; gender: "M" | "F"; panNumber: string;
  addressLine1: string; addressLine2: string; pincode: string; city: string; state: string;
  nomineeName: string; nomineeRelation: string; nomineeAge: number;
}

/** One recorded vendor call, for the raw-exchange drawer. */
export interface FgExchange {
  step: string;
  at: string;
  request: unknown;
  response: unknown;
}

interface FgUatState {
  category: string | null;
  presetId: string | null;
  conditions: FgConditions | null;
  proposer: FgProposer;
  providerAddonCodes: string[];
  quote: CanonicalQuote | null;
  ckyc: string | null;
  kycRefId: string | null;
  proposal: CanonicalQuote | null;
  policyNo: string | null;
  exchanges: FgExchange[];

  setCategory: (c: string) => void;
  setPreset: (id: string | null) => void;
  setConditions: (c: FgConditions) => void;
  setProposer: (p: FgProposer) => void;
  setAddonCodes: (codes: string[]) => void;
  setQuote: (q: CanonicalQuote | null) => void;
  setCkyc: (ckyc: string | null, ref: string | null) => void;
  setProposal: (p: CanonicalQuote | null) => void;
  setPolicyNo: (n: string | null) => void;
  recordExchange: (e: FgExchange) => void;
  reset: () => void;
}

/**
 * Prefilled with the identity proven to clear FG's client creation: PAN
 * DHQPG4064J, and a non-sequential mobile — FG's CreateProposal rejects
 * 9876543210 with "Mobile number is missing or invalid for the entered client".
 * Every field stays editable; this only saves testers rediscovering FG's quirks.
 */
const DEFAULT_PROPOSER: FgProposer = {
  firstName: "Rahul", lastName: "Sharma",
  email: "rahul.sharma@tommyandfurry.com", mobile: "9822012345",
  dob: "1990-05-15", gender: "M", panNumber: "DHQPG4064J",
  addressLine1: "1204 Trade Centre, Bandra Kurla Complex", addressLine2: "Bandra East",
  pincode: "400051", city: "Mumbai", state: "Maharashtra",
  nomineeName: "Sunita Sharma", nomineeRelation: "spouse", nomineeAge: 34,
};

const initial = {
  category: null, presetId: null, conditions: null,
  proposer: DEFAULT_PROPOSER, providerAddonCodes: [] as string[],
  quote: null, ckyc: null, kycRefId: null, proposal: null,
  policyNo: null, exchanges: [] as FgExchange[],
};

export const useFgUatStore = create<FgUatState>()(
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
      setPolicyNo: (policyNo) => set({ policyNo }),
      recordExchange: (e) => set((s) => ({ exchanges: [...s.exchanges, e] })),
      reset: () => set(initial),
    }),
    { name: "fg-uat-journey" },
  ),
);

export { DEFAULT_PROPOSER };
