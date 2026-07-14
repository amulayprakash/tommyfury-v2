import { BadgeCheck, Camera, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { apiErrorMessage } from "@/lib/api/error-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreateInspection, useInspectionStatus } from "../api/hooks";
import type { InspectionResult, SupportedCategory } from "../api/types";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

/** LiveChek vehicle-category slug for a canonical category. */
const LIVECHEK_CATEGORY: Record<SupportedCategory, string> = {
  twoWheeler: "bike",
  fourWheeler: "car",
  commercial: "truck",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Break-in pre-inspection step. FG refuses a break-in proposal without
 * inspection evidence, so this card (a) raises a LiveChek inspection and polls
 * it until it is recommended, or (b) accepts an existing report reference
 * entered manually (e.g. one issued outside the app). Either path stores the
 * report number + date that the proposal then carries.
 */
export function InspectionCard({ providerSlug }: { providerSlug: string }) {
  const vehicle = useVehicleQuoteStore((s) => s.vehicle);
  const proposal = useVehicleQuoteStore((s) => s.proposal);
  const selected = useVehicleQuoteStore((s) => s.selected);
  const inspection = useVehicleQuoteStore((s) => s.inspection);
  const setInspection = useVehicleQuoteStore((s) => s.setInspection);

  const create = useCreateInspection();
  const status = useInspectionStatus();

  const [refId, setRefId] = useState<string | null>(inspection?.refId ?? null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [manualNo, setManualNo] = useState("");
  const [manualDate, setManualDate] = useState(todayIso());

  if (!vehicle || !proposal) return null;

  const done = Boolean(inspection?.reportNumber);
  const busy = create.isPending || status.isPending;

  const applyResult = (result: InspectionResult) => {
    setLastStatus(result.rawStatus ?? result.status);
    if (result.status === "INSPECTION_APPROVED") {
      setInspection({
        refId: result.refId,
        reportNumber: result.inspectionId ?? result.refId,
        date: todayIso(),
      });
      toast.success("Inspection approved — you can proceed to payment.");
    } else if (result.status === "INSPECTION_REJECTED") {
      toast.error("The inspection was not recommended. The policy cannot be issued.");
    } else {
      toast.info("Inspection is still pending. Complete the vehicle photos, then check again.");
    }
  };

  const requestInspection = () => {
    create.mutate(
      {
        provider: providerSlug,
        req: {
          refId: selected?.quote.transactionId ?? selected?.quote.quoteNo ?? vehicle.registrationNumber,
          name: `${proposal.firstName} ${proposal.lastName}`.trim(),
          email: proposal.email,
          mobileNumber: proposal.mobile,
          regNumber: vehicle.registrationNumber,
          vehicleCategory: LIVECHEK_CATEGORY[vehicle.category],
          make: vehicle.makeName,
          brand: vehicle.modelName,
          modelYear: vehicle.registrationDate.slice(0, 4),
          fuelType: vehicle.fuelType,
          city: proposal.city,
        },
      },
      {
        onSuccess: (result) => {
          setRefId(result.refId);
          applyResult(result);
        },
        onError: (err) =>
          toast.error(apiErrorMessage(err, "Could not raise the inspection request.")),
      },
    );
  };

  const checkStatus = () => {
    if (!refId) return;
    status.mutate(
      { provider: providerSlug, refId },
      {
        onSuccess: applyResult,
        onError: (err) => toast.error(apiErrorMessage(err, "Could not fetch inspection status.")),
      },
    );
  };

  const useManual = () => {
    if (!manualNo.trim()) return;
    setInspection({ reportNumber: manualNo.trim(), date: manualDate });
    toast.success("Inspection report attached to the proposal.");
  };

  return (
    <Card className="border-amber-300/60">
      <CardHeader>
        <CardTitle className="text-base">Vehicle inspection required</CardTitle>
        <CardDescription>
          Your previous policy has expired (break-in), so the insurer needs a quick vehicle
          inspection before the policy can be issued.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {done ? (
          <p className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
            <BadgeCheck className="size-4" /> Inspection report {inspection!.reportNumber} (
            {inspection!.date}) will be sent with your proposal.
          </p>
        ) : (
          <>
            {refId ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Inspection requested (ref <span className="font-medium">{refId}</span>
                  {lastStatus ? ` · status: ${lastStatus}` : ""}). Complete the vehicle photos via
                  the LiveChek link sent to your mobile, then check the status.
                </p>
                <Button variant="outline" className="w-full" onClick={checkStatus} disabled={busy}>
                  {status.isPending ? (
                    <>
                      <Loader2 className="animate-spin" /> Checking…
                    </>
                  ) : (
                    <>
                      <RefreshCw /> Check inspection status
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button className="w-full" onClick={requestInspection} disabled={busy}>
                {create.isPending ? (
                  <>
                    <Loader2 className="animate-spin" /> Requesting…
                  </>
                ) : (
                  <>
                    <Camera /> Request LiveChek inspection
                  </>
                )}
              </Button>
            )}

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Already have an inspection report?</p>
              <Input
                value={manualNo}
                onChange={(e) => setManualNo(e.target.value)}
                placeholder="Inspection report number"
              />
              <Input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={useManual}
                disabled={!manualNo.trim() || busy}
              >
                Use this report
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
