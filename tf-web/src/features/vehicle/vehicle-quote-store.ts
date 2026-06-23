import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { RcDetails } from "./api/rc-lookup";
import type {
  AddonKey,
  BusinessType,
  CanonicalQuote,
  CommercialSubType,
  CompareQuotesRequest,
  FuelType,
  PolicyType,
  SupportedCategory,
} from "./api/types";
import { ALL_ADDON_KEYS } from "./api/types";
import type { ProposalValues } from "./lib/proposal-schema";

export const VEHICLE_STORAGE_KEY = "tf.vehicle.v1";

/** Canonical vehicle identity assembled on the confirm-details step. */
export interface ResolvedVehicle {
  category: SupportedCategory;
  businessType: BusinessType;
  makeId: string;
  makeName: string;
  modelId: string;
  modelName: string;
  variantId?: string;
  variantName?: string;
  fuelType: FuelType;
  engineCC?: number;
  seatingCapacity?: number;
  // Commercial-only attributes (goods/passenger sub-type + GVW).
  commercialSubType?: CommercialSubType;
  grossVehicleWeight?: number;
  carryingCapacity?: number;
  rtoCode: string;
  registrationNumber: string;
  registrationDate: string;
  manufactureDate?: string;
  engineNumber?: string;
  chassisNumber?: string;
  ownerName?: string;
  address?: string;
  pincode?: string;
  city?: string;
  state?: string;
  previousInsurerId?: string;
  previousInsurerName?: string;
  previousPolicyNumber?: string;
  previousPolicyExpiryDate?: string;
  isPreviousPolicyExpired: boolean;
}

export interface SelectedPlan {
  providerSlug: string;
  quote: CanonicalQuote;
}

/** Previous third-party policy details — required by FG for standalone OD. */
export interface PreviousTpDetails {
  insurerName?: string;
  policyNumber?: string;
  startDate?: string;
  expiryDate?: string;
}

type AddonState = Partial<Record<AddonKey, boolean>>;

interface VehicleQuoteState {
  category: SupportedCategory | null;
  rc: RcDetails | null;
  vehicle: ResolvedVehicle | null;

  planType: PolicyType;
  idvValue: number | null;
  ncbPercent: number;
  claimInPreviousPolicy: boolean;
  addons: AddonState;
  /** Previous-TP details captured for a standalone-OD quote. */
  previousTp: PreviousTpDetails;

  selected: SelectedPlan | null;
  /** CoverCodes chosen from the selected provider's own add-on catalog. */
  providerAddonCodes: string[];
  proposal: ProposalValues | null;
  panNumber: string | null;

  /** Bound proposal (carries paymentUrl + transactionId) and KYC outcome. */
  fullQuote: CanonicalQuote | null;
  transactionId: string | null;
  kycId: string | null;
  /** CKYC number + ref captured before the proposal (fed into CreateProposal). */
  ckyc: string | null;
  kycRefId: string | null;

  setCategory: (category: SupportedCategory) => void;
  setRc: (rc: RcDetails) => void;
  setVehicle: (vehicle: ResolvedVehicle) => void;
  setPlanType: (planType: PolicyType) => void;
  setIdv: (idv: number | null) => void;
  setNcb: (ncb: number) => void;
  setClaim: (claim: boolean) => void;
  setPreviousTp: (p: PreviousTpDetails) => void;
  toggleAddon: (key: AddonKey, on: boolean) => void;
  setAddons: (addons: AddonState) => void;
  selectPlan: (plan: SelectedPlan) => void;
  setProviderAddonCodes: (codes: string[]) => void;
  setProposal: (proposal: ProposalValues) => void;
  setPan: (pan: string) => void;
  setFullQuote: (transactionId: string, quote: CanonicalQuote) => void;
  setKyc: (kycId: string | null) => void;
  setCkyc: (ckyc: string | null, kycRefId: string | null) => void;
  reset: () => void;
}

const initial = {
  category: null,
  rc: null,
  vehicle: null,
  planType: "comprehensive" as PolicyType,
  idvValue: null,
  ncbPercent: 0,
  claimInPreviousPolicy: false,
  addons: {} as AddonState,
  previousTp: {} as PreviousTpDetails,
  selected: null,
  providerAddonCodes: [] as string[],
  proposal: null,
  panNumber: null,
  fullQuote: null,
  transactionId: null,
  kycId: null,
  ckyc: null,
  kycRefId: null,
};

export const useVehicleQuoteStore = create<VehicleQuoteState>()(
  persist(
    (set) => ({
      ...initial,
      setCategory: (category) => set({ category }),
      setRc: (rc) => set({ rc }),
      setVehicle: (vehicle) => set({ vehicle }),
      setPlanType: (planType) => set({ planType }),
      setIdv: (idvValue) => set({ idvValue }),
      setNcb: (ncbPercent) => set({ ncbPercent }),
      setClaim: (claimInPreviousPolicy) => set({ claimInPreviousPolicy }),
      setPreviousTp: (previousTp) => set({ previousTp }),
      toggleAddon: (key, on) => set((s) => ({ addons: { ...s.addons, [key]: on } })),
      setAddons: (addons) => set({ addons }),
      selectPlan: (selected) => set({ selected }),
      setProviderAddonCodes: (providerAddonCodes) => set({ providerAddonCodes }),
      setProposal: (proposal) => set({ proposal }),
      setPan: (panNumber) => set({ panNumber }),
      setFullQuote: (transactionId, fullQuote) => set({ transactionId, fullQuote }),
      setKyc: (kycId) => set({ kycId }),
      setCkyc: (ckyc, kycRefId) => set({ ckyc, kycRefId }),
      reset: () => set({ ...initial }),
    }),
    {
      name: VEHICLE_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

type QuoteInputs = Pick<
  VehicleQuoteState,
  | "vehicle"
  | "planType"
  | "idvValue"
  | "ncbPercent"
  | "claimInPreviousPolicy"
  | "addons"
  | "previousTp"
>;

/**
 * Assembles the canonical quote request from the current journey state.
 * Returns null until a vehicle has been resolved.
 */
export function buildQuoteRequest(state: QuoteInputs): CompareQuotesRequest | null {
  const v = state.vehicle;
  if (!v) return null;

  const addonFlags = Object.fromEntries(
    ALL_ADDON_KEYS.map((key) => [key, Boolean(state.addons[key])]),
  ) as Record<AddonKey, boolean>;

  return {
    vehicleType: v.category,
    selectedPolicy: state.planType,
    businessType: v.businessType,
    makeId: v.makeId,
    makeName: v.makeName,
    modelId: v.modelId,
    modelName: v.modelName,
    variantId: v.variantId,
    variantName: v.variantName,
    fuelType: v.fuelType,
    engineCC: v.engineCC,
    rtoCode: v.rtoCode,
    registrationDate: v.registrationDate,
    registrationNumber: v.registrationNumber,
    previousPolicyNumber: v.previousPolicyNumber,
    previousInsurerId: v.previousInsurerId,
    previousInsurerName: v.previousInsurerName,
    previousPolicyExpiryDate: v.previousPolicyExpiryDate,
    isPreviousPolicyExpired: v.isPreviousPolicyExpired,
    claimInPreviousPolicy: state.claimInPreviousPolicy,
    ncbPercent: state.ncbPercent,
    // Previous-TP details (FG needs an ACTIVE TP policy for standalone OD).
    ...(state.planType === "standAloneOD"
      ? {
          previousInsurerName: state.previousTp.insurerName || v.previousInsurerName,
          previousTpPolicyNumber: state.previousTp.policyNumber || v.previousPolicyNumber,
          previousTpStartDate: state.previousTp.startDate,
          previousTpExpiryDate: state.previousTp.expiryDate,
        }
      : {}),
    ...(state.idvValue ? { idvValue: state.idvValue } : {}),
    ...(v.seatingCapacity ? { seatingCapacity: v.seatingCapacity } : {}),
    ...(v.commercialSubType ? { commercialSubType: v.commercialSubType } : {}),
    ...(v.grossVehicleWeight ? { grossVehicleWeight: v.grossVehicleWeight } : {}),
    ...(v.carryingCapacity ? { carryingCapacity: v.carryingCapacity } : {}),
    ...addonFlags,
  };
}
