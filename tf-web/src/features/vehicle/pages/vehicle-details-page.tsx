import { ArrowRight, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMmvSearch } from "../api/hooks";
import { COMMERCIAL_SUBTYPE_LABELS, type CommercialSubType } from "../api/types";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore, type ResolvedVehicle } from "../vehicle-quote-store";

const tokenize = (s: string): string[] =>
  s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1);

/**
 * Picks the master variant that best matches the RC: same fuel, closest cubic
 * capacity, and the most variant-name token overlap with the RC's model string
 * (e.g. "Grand I10 Magna AT" → prefers the AT Magna variant). Falls back to 0.
 */
function pickBestVariant(
  variants: { fuelType: string; engineCC?: number | null; variantName?: string | null }[],
  rc: { fuelType?: string; cubicCapacity?: number; makerModel?: string } | null,
): number {
  if (variants.length === 0) return 0;
  const rcTokens = tokenize(rc?.makerModel ?? "");
  let bestIdx = 0;
  let bestScore = -1;
  variants.forEach((v, i) => {
    let score = 0;
    if (rc?.fuelType && v.fuelType === rc.fuelType) score += 3;
    if (rc?.cubicCapacity && v.engineCC) {
      const d = Math.abs(v.engineCC - rc.cubicCapacity);
      if (d === 0) score += 3;
      else if (d <= 50) score += 1;
    }
    const vTokens = new Set(tokenize(v.variantName ?? ""));
    score += rcTokens.filter((t) => vTokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || "—"}</span>
    </div>
  );
}

/** Step 2 — confirm RC details, resolve canonical make/model/variant, fetch plans. */
export function VehicleDetailsPage() {
  const navigate = useNavigate();
  const rc = useVehicleQuoteStore((s) => s.rc);
  const category = useVehicleQuoteStore((s) => s.category);
  const setVehicle = useVehicleQuoteStore((s) => s.setVehicle);

  const make = rc?.makerDescription?.split(/\s+/)[0];
  // RC model is the full variant string (e.g. "Bolt Xt 1.2Rt") which won't match
  // the master's model name ("BOLT") — search by the leading model word instead.
  const modelTerm = rc?.makerModel?.trim().split(/\s+/)[0];
  const mmv = useMmvSearch(
    { make, model: modelTerm, category: category ?? undefined },
    Boolean(rc && category),
  );

  const variants = useMemo(() => mmv.data ?? [], [mmv.data]);
  // Auto-select the closest variant once results load; user can still override.
  const bestVariantIdx = useMemo(() => pickBestVariant(variants, rc), [variants, rc]);
  const [variantOverride, setVariantOverride] = useState<number | null>(null);
  const variantIdx = variantOverride ?? bestVariantIdx;
  const [regDate, setRegDate] = useState(rc?.registrationDate ?? "");

  // Commercial-only inputs (RC lookup can't supply these).
  const isCommercial = category === "commercial";
  const [subType, setSubType] = useState<CommercialSubType>("goods");
  const [grossWeight, setGrossWeight] = useState("");
  const [seating, setSeating] = useState(rc?.seatCapacity ? String(rc.seatCapacity) : "");

  const rtoCode = useMemo(
    () => rc?.rtoCode || rc?.rcNumber.slice(0, 4) || "",
    [rc],
  );

  if (!rc || !category) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Start by entering your vehicle number.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.start}>Start over</Link>
        </Button>
      </div>
    );
  }

  const onViewPlans = () => {
    const chosen = variants[variantIdx];
    const vehicle: ResolvedVehicle = {
      category,
      businessType: "rollover",
      makeId: chosen?.makeId ?? rc.makerDescription ?? "UNKNOWN",
      makeName: chosen?.makeName ?? rc.makerDescription ?? "Unknown",
      modelId: chosen?.modelId ?? rc.makerModel ?? "UNKNOWN",
      modelName: chosen?.modelName ?? rc.makerModel ?? "Unknown",
      variantId: chosen?.variantId ?? undefined,
      variantName: chosen?.variantName ?? undefined,
      // Use the chosen master variant's fuel so it matches the resolved MMV row.
      fuelType: (chosen?.fuelType as ResolvedVehicle["fuelType"]) ?? rc.fuelType,
      engineCC: chosen?.engineCC ?? rc.cubicCapacity ?? undefined,
      seatingCapacity: seating ? Number(seating) : (rc.seatCapacity ?? undefined),
      rtoCode,
      registrationNumber: rc.rcNumber,
      registrationDate: regDate,
      manufactureDate: rc.manufacturingDate,
      engineNumber: rc.engineNumber,
      chassisNumber: rc.chassisNumber,
      ownerName: rc.ownerName,
      address: rc.presentAddress,
      pincode: rc.pincode,
      previousInsurerName: rc.previousInsurerName,
      previousPolicyNumber: rc.previousPolicyNumber,
      previousPolicyExpiryDate: rc.previousPolicyExpiryDate,
      isPreviousPolicyExpired: rc.isPreviousPolicyExpired,
      ...(isCommercial
        ? {
            commercialSubType: subType,
            grossVehicleWeight: grossWeight ? Number(grossWeight) : undefined,
          }
        : {}),
    };
    setVehicle(vehicle);
    void navigate(ROUTES.vehicle.quotes);
  };

  const vehicleName = [rc.makerDescription, rc.makerModel].filter(Boolean).join(" ");

  return (
    <div>
      <WizardSteps current={0} />
      <Card className="mx-auto max-w-xl">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            Your{" "}
            {category === "twoWheeler"
              ? "two wheeler"
              : category === "commercial"
                ? "commercial vehicle"
                : "car"}{" "}
            details
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to={ROUTES.vehicle.start}>
              <Pencil className="size-3.5" /> Edit
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <DetailRow label="Vehicle number" value={rc.rcNumber} />
            <DetailRow label="Vehicle" value={vehicleName} />
            <DetailRow label="Fuel" value={rc.fuelType} />
            <DetailRow label="RTO" value={rtoCode} />
            <DetailRow label="Owner" value={rc.ownerName} />
            <DetailRow label="Previous insurer" value={rc.previousInsurerName} />
            <DetailRow label="Previous policy expiry" value={rc.previousPolicyExpiryDate} />
          </div>

          <div className="mt-5 space-y-4">
            {variants.length > 0 ? (
              <label className="block space-y-2">
                <span className="text-sm font-medium">Confirm variant</span>
                <select
                  value={variantIdx}
                  onChange={(e) => setVariantOverride(Number(e.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {variants.map((v, i) => (
                    <option key={v.id} value={i}>
                      {[v.makeName, v.modelName, v.variantName].filter(Boolean).join(" ")} ·{" "}
                      {v.fuelType}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {!regDate ? (
              <label className="block space-y-2">
                <span className="text-sm font-medium">Registration date</span>
                <Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} />
              </label>
            ) : null}

            {isCommercial ? (
              <>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Vehicle type</span>
                  <select
                    value={subType}
                    onChange={(e) => setSubType(e.target.value as CommercialSubType)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          </div>

          <Button
            size="lg"
            className="mt-6 w-full"
            onClick={onViewPlans}
            disabled={!regDate}
          >
            View plans <ArrowRight />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
