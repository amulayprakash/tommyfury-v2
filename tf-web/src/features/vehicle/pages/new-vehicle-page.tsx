import { ArrowRight, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMmvSearch, useRtoSearch } from "../api/hooks";
import type { MmvItem, RtoItem } from "../api/vehicle-api";
import {
  COMMERCIAL_SUBTYPE_LABELS,
  type CommercialSubType,
  type SupportedCategory,
} from "../api/types";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore, type ResolvedVehicle } from "../vehicle-quote-store";

/** Maps each category back to its RC-lookup start route (for the "look it up" link). */
const START_ROUTE: Record<SupportedCategory, string> = {
  twoWheeler: ROUTES.vehicle.start,
  fourWheeler: ROUTES.vehicle.carStart,
  commercial: ROUTES.vehicle.newCommercial,
};

const CATEGORY_NOUN: Record<SupportedCategory, string> = {
  twoWheeler: "two wheeler",
  fourWheeler: "car",
  commercial: "commercial vehicle",
};

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const today = () => new Date().toISOString().slice(0, 10);

/** Debounces a fast-changing value (typeahead input) to limit API calls. */
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

interface ComboboxProps<T> {
  placeholder: string;
  query: string;
  onQueryChange: (q: string) => void;
  results: T[];
  isLoading: boolean;
  getKey: (item: T) => string | number;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  selectedLabel?: string | null;
  onClear: () => void;
}

/** Minimal typeahead: search box → results dropdown → a chip once chosen. */
function Combobox<T>({
  placeholder,
  query,
  onQueryChange,
  results,
  isLoading,
  getKey,
  renderItem,
  onSelect,
  selectedLabel,
  onClear,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);

  if (selectedLabel) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">{selectedLabel}</span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className="pl-9"
      />
      {open && (isLoading || results.length > 0) ? (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-input bg-popover shadow-md">
          {isLoading ? (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching…
            </li>
          ) : (
            results.map((item) => (
              <li key={getKey(item)}>
                <button
                  type="button"
                  // onMouseDown fires before the input's onBlur, so the pick registers.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(item);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {renderItem(item)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

interface NewVehiclePageProps {
  category: SupportedCategory;
}

/**
 * Manual entry for a brand-new vehicle with no RC yet. Collects make/model/variant
 * + RTO + purchase date (engine/chassis come later at the proposal step), then
 * resolves a `businessType: "new"` vehicle and jumps straight to the quotes step.
 */
export function NewVehiclePage({ category }: NewVehiclePageProps) {
  const navigate = useNavigate();
  const setVehicle = useVehicleQuoteStore((s) => s.setVehicle);
  const setCategory = useVehicleQuoteStore((s) => s.setCategory);
  const reset = useVehicleQuoteStore((s) => s.reset);

  // Vehicle (make/model/variant) typeahead — parsed as make + model like the
  // RC confirm step does, so "Maruti Swift" filters both columns.
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [selectedMmv, setSelectedMmv] = useState<MmvItem | null>(null);
  const debouncedVehicle = useDebouncedValue(vehicleQuery);
  const mmvParams = useMemo(() => {
    const [make, ...rest] = debouncedVehicle.trim().split(/\s+/).filter(Boolean);
    return { make, model: rest.join(" ") || undefined, category };
  }, [debouncedVehicle, category]);
  const mmv = useMmvSearch(mmvParams, !selectedMmv && debouncedVehicle.trim().length >= 2);
  const mmvResults = useMemo(() => mmv.data ?? [], [mmv.data]);

  // RTO typeahead (by code or city).
  const [rtoQuery, setRtoQuery] = useState("");
  const [selectedRto, setSelectedRto] = useState<RtoItem | null>(null);
  const debouncedRto = useDebouncedValue(rtoQuery);
  const rto = useRtoSearch(debouncedRto.trim(), !selectedRto && debouncedRto.trim().length >= 1);
  const rtoResults = useMemo(() => rto.data ?? [], [rto.data]);

  const [regDate, setRegDate] = useState(today());

  // Commercial-only inputs (mirrors the RC confirm step).
  const isCommercial = category === "commercial";
  const [subType, setSubType] = useState<CommercialSubType>("goods");
  const [grossWeight, setGrossWeight] = useState("");
  const [seating, setSeating] = useState("");

  const canSubmit = Boolean(selectedMmv && selectedRto && regDate);

  const onViewPlans = () => {
    if (!selectedMmv || !selectedRto) return;
    const vehicle: ResolvedVehicle = {
      category,
      businessType: "new",
      makeId: selectedMmv.makeId,
      makeName: selectedMmv.makeName,
      modelId: selectedMmv.modelId,
      modelName: selectedMmv.modelName,
      variantId: selectedMmv.variantId ?? undefined,
      variantName: selectedMmv.variantName ?? undefined,
      fuelType: selectedMmv.fuelType as ResolvedVehicle["fuelType"],
      engineCC: selectedMmv.engineCC ?? undefined,
      seatingCapacity: seating ? Number(seating) : undefined,
      rtoCode: selectedRto.code,
      registrationNumber: "",
      registrationDate: regDate,
      city: selectedRto.city,
      state: selectedRto.state,
      // No previous policy for a brand-new vehicle.
      isPreviousPolicyExpired: false,
      ...(isCommercial
        ? {
            commercialSubType: subType,
            grossVehicleWeight: grossWeight ? Number(grossWeight) : undefined,
          }
        : {}),
    };
    // Start a clean journey (clears any prior RC/rollover state), then store the
    // resolved new vehicle and head to the quotes step. `rc` stays null.
    reset();
    setCategory(category);
    setVehicle(vehicle);
    void navigate(ROUTES.vehicle.quotes);
  };

  return (
    <div>
      <WizardSteps current={0} />
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>New {CATEGORY_NOUN[category]} details</CardTitle>
          <CardDescription>
            Just bought it and don’t have a registration number yet? Pick your vehicle
            and RTO below — we’ll take the engine &amp; chassis number later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium">Make &amp; model</span>
            <Combobox<MmvItem>
              placeholder="e.g. Maruti Swift VXI"
              query={vehicleQuery}
              onQueryChange={setVehicleQuery}
              results={mmvResults}
              isLoading={mmv.isFetching}
              getKey={(v) => v.id}
              renderItem={(v) => (
                <>
                  <span className="font-medium">
                    {[v.makeName, v.modelName, v.variantName].filter(Boolean).join(" ")}
                  </span>{" "}
                  <span className="text-muted-foreground">· {v.fuelType}</span>
                </>
              )}
              onSelect={setSelectedMmv}
              selectedLabel={
                selectedMmv
                  ? `${[selectedMmv.makeName, selectedMmv.modelName, selectedMmv.variantName]
                      .filter(Boolean)
                      .join(" ")} · ${selectedMmv.fuelType}`
                  : null
              }
              onClear={() => {
                setSelectedMmv(null);
                setVehicleQuery("");
              }}
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">RTO (where it will be registered)</span>
            <Combobox<RtoItem>
              placeholder="Search by RTO code or city, e.g. MH01"
              query={rtoQuery}
              onQueryChange={setRtoQuery}
              results={rtoResults}
              isLoading={rto.isFetching}
              getKey={(r) => r.id}
              renderItem={(r) => (
                <>
                  <span className="font-medium">{r.code}</span>{" "}
                  <span className="text-muted-foreground">
                    · {r.city}, {r.state}
                  </span>
                </>
              )}
              onSelect={setSelectedRto}
              selectedLabel={
                selectedRto ? `${selectedRto.code} · ${selectedRto.city}, ${selectedRto.state}` : null
              }
              onClear={() => {
                setSelectedRto(null);
                setRtoQuery("");
              }}
            />
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Purchase / delivery date</span>
            <Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} />
          </label>

          {isCommercial ? (
            <>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Vehicle type</span>
                <select
                  value={subType}
                  onChange={(e) => setSubType(e.target.value as CommercialSubType)}
                  className={SELECT_CLASS}
                >
                  {Object.entries(COMMERCIAL_SUBTYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Gross weight (kg)</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={grossWeight}
                    onChange={(e) => setGrossWeight(e.target.value)}
                    placeholder="e.g. 7500"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Seating capacity</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={seating}
                    onChange={(e) => setSeating(e.target.value)}
                    placeholder="e.g. 2"
                  />
                </label>
              </div>
            </>
          ) : null}

          <Button size="lg" className="mt-2 w-full" onClick={onViewPlans} disabled={!canSubmit}>
            View plans <ArrowRight />
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already registered?{" "}
            <Link to={START_ROUTE[category]} className="font-medium text-primary hover:underline">
              Look it up by number
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
