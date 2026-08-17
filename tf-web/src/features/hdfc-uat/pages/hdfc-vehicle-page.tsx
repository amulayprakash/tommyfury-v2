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
  AccessoryFields,
  CheckField,
  CpaFields,
  Field,
  NcbClaimFields,
  NomineeFields,
  PresetWarning,
  PreviousPolicyFields,
  PreviousTpFields,
  SELECT_CLASS,
} from "../components/condition-fields";
import { CATEGORY_LABELS, hdfcPlanTypes } from "../hdfc-capabilities";
import { useHdfcUatStore, type HdfcConditions } from "../hdfc-uat-store";
import { HDFC_PRESETS, presetById } from "../test-presets";

/**
 * Step 2 of the HDFC certification harness — vehicle plus every policy condition
 * the certification scenarios turn on, all directly editable.
 *
 * The customer wizard hides most of this (it comes from the RC lookup, or is
 * inferred). A tester can't work that way: they need to *state* the condition
 * under test, so nothing here is derived and nothing is validated beyond what
 * HDFC itself will reject.
 */

const BUSINESS_TYPES: { value: HdfcConditions["businessType"]; label: string }[] = [
  { value: "new", label: "New business" },
  { value: "rollover", label: "Rollover" },
];

/** HDFC sells long-term new-business terms; 1+3 is one of the certified scenarios. */
const TENURES = [1, 2, 3];

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_CONDITIONS: HdfcConditions = {
  makeId: "", makeName: "", modelId: "", modelName: "",
  fuelType: "", rtoCode: "", registrationNumber: "", registrationDate: today(),
  engineNumber: "", chassisNumber: "",
  businessType: "rollover", isUsedVehiclePurchase: false,
  planType: "comprehensive", tenureYears: 1, paOwner: true,
  previousInsurerId: "", previousInsurerName: "", previousPolicyNumber: "",
  isPreviousPolicyExpired: false,
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

export function HdfcVehiclePage() {
  const navigate = useNavigate();
  const providers = useProviders();
  const category = useHdfcUatStore((s) => s.category);
  const stored = useHdfcUatStore((s) => s.conditions);
  const presetId = useHdfcUatStore((s) => s.presetId);
  const proposer = useHdfcUatStore((s) => s.proposer);
  const setPreset = useHdfcUatStore((s) => s.setPreset);
  const setConditions = useHdfcUatStore((s) => s.setConditions);
  const setProposer = useHdfcUatStore((s) => s.setProposer);
  const setAddonCodes = useHdfcUatStore((s) => s.setAddonCodes);

  const hdfc = providers.data?.find((p) => p.slug === "hdfc");
  const planTypes = hdfcPlanTypes(hdfc, category ?? "");

  const [conditions, setLocal] = useState<HdfcConditions>(stored ?? EMPTY_CONDITIONS);
  const patch = (p: Partial<HdfcConditions>) => setLocal((c) => ({ ...c, ...p }));
  const patchProposer = (p: Partial<typeof proposer>) => setProposer({ ...proposer, ...p });

  const preset = presetById(presetId);

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
      fuelType: v.fuelType,
      engineCC: v.engineCC ?? undefined,
    });

  const clearMmv = () => {
    setVehicleQuery("");
    patch({
      makeId: "", makeName: "", modelId: "", modelName: "",
      fuelType: "", engineCC: undefined,
    });
  };

  /**
   * An HDFC preset carries the WHOLE condition set, not a patch: HDFC's UAT
   * prices only vehicles about a year old or newer, so a preset that left the
   * vehicle to whatever was on screen would mostly fail to quote. Its add-on
   * selection is loaded with it, for the same reason.
   */
  const loadPreset = (id: string) => {
    setPreset(id || null);
    const p = presetById(id);
    if (!p) return;
    setLocal({ ...p.conditions });
    setAddonCodes(p.addonCodes ?? []);
    if (p.proposerOverrides) setProposer({ ...proposer, ...p.proposerOverrides });
  };

  const canContinue = Boolean(
    conditions.makeId && conditions.modelId && conditions.rtoCode && conditions.registrationDate,
  );

  const onContinue = () => {
    setConditions(conditions);
    void navigate(ROUTES.hdfcUat.plans);
  };

  const vehicleLabel = hasVehicle
    ? `${[conditions.makeName, conditions.modelName].filter(Boolean).join(" ")} · ${conditions.fuelType}`
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">
          Vehicle &amp; policy conditions
          {category ? ` — ${CATEGORY_LABELS[category] ?? category}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every condition the certification scenarios turn on is editable here — nothing is derived.
        </p>
      </div>

      <Field label="Test case">
        <select
          value={presetId ?? ""}
          onChange={(e) => loadPreset(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">No preset — enter conditions manually</option>
          {HDFC_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      {preset ? <p className="text-xs text-muted-foreground">{preset.describes}</p> : null}
      {/* Shown here, at the top of the step BEFORE the quote is fired, rather
          than as a surprise once HDFC refuses the proposal three steps later. */}
      <PresetWarning warning={preset?.warning} />

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Vehicle</h2>
        <Field label="Make & model">
          <Combobox<MmvItem>
            placeholder="e.g. Maruti Swift ZXI"
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
          {/* Free text on purpose: the certification scenarios use fictional
              plates (MH01QQ7878) that no registry would accept, and new business
              has no plate at all. */}
          <Field label="Registration number">
            <Input
              value={conditions.registrationNumber}
              onChange={(e) => patch({ registrationNumber: e.target.value.toUpperCase() })}
              placeholder="e.g. MH01QQ7878 (blank for new business)"
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
              placeholder="e.g. ENG1234567890123"
            />
          </Field>
          <Field label="Chassis number">
            <Input
              value={conditions.chassisNumber}
              onChange={(e) => patch({ chassisNumber: e.target.value })}
              placeholder="17 characters, e.g. MA3EWDE1S00123456"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          HDFC&apos;s UAT prices only vehicles roughly a year old or newer — an older registration
          date is the usual reason a quote comes back empty.
        </p>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Business</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Business type">
            <select
              value={conditions.businessType}
              onChange={(e) =>
                patch({ businessType: e.target.value as HdfcConditions["businessType"] })
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
          <Field label="Own-damage tenure (years)">
            <select
              value={String(conditions.tenureYears)}
              onChange={(e) => patch({ tenureYears: Number(e.target.value) })}
              className={SELECT_CLASS}
            >
              {TENURES.map((t) => (
                <option key={t} value={t}>
                  {t}
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
              placeholder="Blank for HDFC's default"
            />
          </Field>
        </div>
        {/* HDFC's Used Car product is a separate flag, not a business type — a
            rollover on a just-bought second-hand car is still a rollover. */}
        <CheckField
          label="Used-vehicle purchase (HDFC's Used Car product)"
          checked={conditions.isUsedVehiclePurchase}
          onChange={(isUsedVehiclePurchase) => patch({ isUsedVehiclePurchase })}
        />
        <p className="text-xs text-muted-foreground">
          On new business HDFC derives the statutory 3-year third-party leg itself — a 1-year
          own-damage tenure is what &ldquo;1+3&rdquo; means here.
        </p>
      </section>

      <CpaFields conditions={conditions} onChange={patch} />
      <PreviousPolicyFields conditions={conditions} onChange={patch} />
      {conditions.planType === "standAloneOD" ? (
        <PreviousTpFields conditions={conditions} onChange={patch} />
      ) : null}
      <NcbClaimFields conditions={conditions} onChange={patch} />
      <AccessoryFields conditions={conditions} onChange={patch} />
      <NomineeFields proposer={proposer} onChange={patchProposer} />

      <Button size="lg" className="w-full" onClick={onContinue} disabled={!canContinue}>
        Continue <ArrowRight />
      </Button>
    </div>
  );
}
