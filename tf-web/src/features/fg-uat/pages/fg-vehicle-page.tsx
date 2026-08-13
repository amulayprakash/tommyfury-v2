import { ArrowRight, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMmvSearch, useProviders, useRtoSearch } from "../../vehicle/api/hooks";
import { POLICY_TYPE_LABELS } from "../../vehicle/api/types";
import type { PolicyType } from "../../vehicle/api/types";
import type { MmvItem, RtoItem } from "../../vehicle/api/vehicle-api";
import {
  BreakInFields,
  CommercialFields,
  Field,
  NcbClaimFields,
  PreviousPolicyFields,
  PreviousTpFields,
  SELECT_CLASS,
} from "../components/condition-fields";
import { CATEGORY_LABELS, fgPlanTypes } from "../fg-capabilities";
import { useFgUatStore, type FgConditions } from "../fg-uat-store";
import { applyPreset, FG_TEST_PRESETS } from "../test-presets";

/**
 * Step 2 of the FG certification harness — vehicle plus every policy condition
 * the 37 cases turn on, all directly editable.
 *
 * The customer wizard hides most of this (it comes from the RC lookup, or is
 * inferred). A tester can't work that way: they need to *state* the condition
 * under test, so nothing here is derived and nothing is validated beyond what
 * FG itself will reject.
 */

const BUSINESS_TYPES: { value: FgConditions["businessType"]; label: string }[] = [
  { value: "new", label: "New business" },
  { value: "rollover", label: "Rollover" },
  { value: "renewal", label: "Renewal (FG expiring policy)" },
];

/** Plates FG's certification pack names, so testers don't dig them out of the workbook. */
const BLACKLISTED_PLATES = ["MH02EP6349", "MH02EE7034", "MH14DX6896", "GJ05RB3983"];
const DUPLICATE_PLATES = ["MH01UH5433", "MH01UH8756"];

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_CONDITIONS: FgConditions = {
  makeId: "", makeName: "", modelId: "", modelName: "",
  fuelType: "", rtoCode: "", registrationNumber: "", registrationDate: today(),
  engineNumber: "", chassisNumber: "",
  businessType: "rollover", planType: "comprehensive",
  previousInsurerName: "", previousPolicyNumber: "", isPreviousPolicyExpired: false,
  ncbPercent: 0, claimInPreviousPolicy: false,
};

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

export function FgVehiclePage() {
  const navigate = useNavigate();
  const providers = useProviders();
  const category = useFgUatStore((s) => s.category);
  const stored = useFgUatStore((s) => s.conditions);
  const presetId = useFgUatStore((s) => s.presetId);
  const setPreset = useFgUatStore((s) => s.setPreset);
  const setConditions = useFgUatStore((s) => s.setConditions);

  const fg = providers.data?.find((p) => p.slug === "fg");
  const planTypes = fgPlanTypes(fg, category ?? "");

  const [conditions, setLocal] = useState<FgConditions>(stored ?? EMPTY_CONDITIONS);
  const patch = (p: Partial<FgConditions>) => setLocal((c) => ({ ...c, ...p }));

  // Vehicle (make/model/variant) typeahead — first word is the make, the rest
  // the model, so "Maruti Swift" filters both columns.
  const [vehicleQuery, setVehicleQuery] = useState("");
  const debouncedVehicle = useDebouncedValue(vehicleQuery);
  const mmvParams = useMemo(() => {
    const [make, ...rest] = debouncedVehicle.trim().split(/\s+/).filter(Boolean);
    return { make, model: rest.join(" ") || undefined, category: category ?? undefined };
  }, [debouncedVehicle, category]);
  const hasVehicle = Boolean(conditions.modelId);
  const mmv = useMmvSearch(mmvParams, !hasVehicle && debouncedVehicle.trim().length >= 2);
  const mmvResults = useMemo(() => mmv.data ?? [], [mmv.data]);

  // RTO typeahead (by code or city).
  const [rtoQuery, setRtoQuery] = useState("");
  const debouncedRto = useDebouncedValue(rtoQuery);
  const hasRto = Boolean(conditions.rtoCode);
  const rto = useRtoSearch(debouncedRto.trim(), !hasRto && debouncedRto.trim().length >= 1);
  const rtoResults = useMemo(() => rto.data ?? [], [rto.data]);

  const selectMmv = (v: MmvItem) =>
    patch({
      makeId: v.makeId,
      makeName: v.makeName,
      modelId: v.modelId,
      modelName: v.modelName,
      variantId: v.variantId ?? undefined,
      variantName: v.variantName ?? undefined,
      fuelType: v.fuelType,
      engineCC: v.engineCC ?? undefined,
    });

  const clearMmv = () => {
    setVehicleQuery("");
    patch({
      makeId: "", makeName: "", modelId: "", modelName: "",
      variantId: undefined, variantName: undefined, fuelType: "", engineCC: undefined,
    });
  };

  const isCommercial = category === "commercial" || category === "newCommercial";
  const canContinue = Boolean(
    conditions.makeId && conditions.modelId && conditions.rtoCode && conditions.registrationDate,
  );

  const onContinue = () => {
    setConditions(conditions);
    void navigate(ROUTES.fgUat.plans);
  };

  const vehicleLabel = hasVehicle
    ? `${[conditions.makeName, conditions.modelName, conditions.variantName]
        .filter(Boolean)
        .join(" ")} · ${conditions.fuelType}`
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">
          Vehicle &amp; policy conditions
          {category ? ` — ${CATEGORY_LABELS[category] ?? category}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every condition the certification cases turn on is editable here — nothing is derived.
        </p>
      </div>

      <Field label="Test case">
        <select
          value={presetId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            setPreset(id || null);
            if (id) setLocal(applyPreset(conditions, id));
          }}
          className={SELECT_CLASS}
        >
          <option value="">No preset — enter conditions manually</option>
          {FG_TEST_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Vehicle</h2>
        <Field label="Make & model">
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
            onSelect={selectMmv}
            selectedLabel={vehicleLabel}
            onClear={clearMmv}
          />
        </Field>

        <Field label="RTO">
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
            onSelect={(r) => patch({ rtoCode: r.code })}
            selectedLabel={hasRto ? conditions.rtoCode : null}
            onClear={() => {
              setRtoQuery("");
              patch({ rtoCode: "" });
            }}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Free text on purpose: FG's kit uses fictional plates (MH01BR4488) that
              no registry would accept, and the blacklist cases need invalid ones. */}
          <Field label="Registration number">
            <Input
              value={conditions.registrationNumber}
              onChange={(e) => patch({ registrationNumber: e.target.value.toUpperCase() })}
              placeholder="e.g. MH01BR4488"
              autoComplete="off"
            />
          </Field>
          <Field label="Registration date">
            <DateInput
              value={conditions.registrationDate}
              onChange={(iso) => patch({ registrationDate: iso })}
            />
          </Field>
          <Field label="Engine number">
            <Input
              value={conditions.engineNumber}
              onChange={(e) => patch({ engineNumber: e.target.value })}
              placeholder="e.g. K12MN1234567"
            />
          </Field>
          <Field label="Chassis number">
            <Input
              value={conditions.chassisNumber}
              onChange={(e) => patch({ chassisNumber: e.target.value })}
              placeholder="e.g. MA3EYD81S00123456"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Business</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Business type">
            <select
              value={conditions.businessType}
              onChange={(e) =>
                patch({ businessType: e.target.value as FgConditions["businessType"] })
              }
              className={SELECT_CLASS}
            >
              {BUSINESS_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Plan type">
            <select
              value={conditions.planType}
              onChange={(e) => patch({ planType: e.target.value })}
              className={SELECT_CLASS}
            >
              {planTypes.map((p) => (
                <option key={p} value={p}>
                  {POLICY_TYPE_LABELS[p as PolicyType] ?? p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="IDV override (optional)">
            <Input
              type="number"
              inputMode="numeric"
              value={conditions.idvValue === undefined ? "" : String(conditions.idvValue)}
              onChange={(e) =>
                patch({ idvValue: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              placeholder="Leave blank for FG's default"
            />
          </Field>
        </div>
      </section>

      <PreviousPolicyFields conditions={conditions} onChange={patch} />
      {conditions.planType === "standAloneOD" ? (
        <PreviousTpFields conditions={conditions} onChange={patch} />
      ) : null}
      <NcbClaimFields conditions={conditions} onChange={patch} />
      <BreakInFields conditions={conditions} onChange={patch} />
      {isCommercial ? <CommercialFields conditions={conditions} onChange={patch} /> : null}

      <p className="text-xs text-muted-foreground">
        Plates the certification cases call for — blacklisted: {BLACKLISTED_PLATES.join(", ")};
        duplicate: {DUPLICATE_PLATES.join(", ")}.
      </p>

      <Button size="lg" className="w-full" onClick={onContinue} disabled={!canContinue}>
        Continue <ArrowRight />
      </Button>
    </div>
  );
}
