import { ArrowRight, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMmvSearch } from "../api/hooks";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore, type ResolvedVehicle } from "../vehicle-quote-store";

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
  const mmv = useMmvSearch(
    { make, model: rc?.makerModel, category: category ?? undefined },
    Boolean(rc && category),
  );

  const variants = mmv.data ?? [];
  const [variantIdx, setVariantIdx] = useState(0);
  const [regDate, setRegDate] = useState(rc?.registrationDate ?? "");

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
      fuelType: rc.fuelType,
      engineCC: chosen?.engineCC ?? rc.cubicCapacity ?? undefined,
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
          <CardTitle>Your {category === "twoWheeler" ? "two wheeler" : "car"} details</CardTitle>
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
                  onChange={(e) => setVariantIdx(Number(e.target.value))}
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
