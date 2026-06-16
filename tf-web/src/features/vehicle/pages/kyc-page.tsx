import { ArrowRight, BadgeCheck, Loader2, ShieldAlert } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCkyc, useProviders } from "../api/hooks";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

export function KycPage() {
  const navigate = useNavigate();
  const selected = useVehicleQuoteStore((s) => s.selected);
  const proposal = useVehicleQuoteStore((s) => s.proposal);
  const transactionId = useVehicleQuoteStore((s) => s.transactionId);
  const panNumber = useVehicleQuoteStore((s) => s.panNumber);
  const kycId = useVehicleQuoteStore((s) => s.kycId);
  const setKyc = useVehicleQuoteStore((s) => s.setKyc);

  const providers = useProviders();
  const ckyc = useCkyc();

  if (!selected || !transactionId) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Generate your full quote first.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.coverage}>Back to review</Link>
        </Button>
      </div>
    );
  }

  const provider = providers.data?.find((p) => p.slug === selected.providerSlug);
  const supportsKyc = provider?.operations.includes("ckyc") ?? false;

  const runKyc = () => {
    ckyc.mutate(
      {
        provider: selected.providerSlug,
        req: {
          transactionId,
          dob: proposal?.dob ?? "",
          panNumber: panNumber ?? undefined,
          policyType: "motor",
        },
      },
      {
        onSuccess: (result) => {
          if (result.isKycSuccess) {
            setKyc(result.kycId ?? "verified");
            toast.success("KYC verified");
            void navigate(ROUTES.vehicle.paymentPage);
          } else {
            toast.error(result.displayMessage ?? "KYC could not be completed automatically.");
          }
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "KYC verification failed."),
      },
    );
  };

  const proceed = () => {
    setKyc("not-required");
    void navigate(ROUTES.vehicle.paymentPage);
  };

  return (
    <div>
      <WizardSteps current={3} />
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BadgeCheck className="size-6" />
          </div>
          <CardTitle>KYC verification</CardTitle>
          <CardDescription>
            {supportsKyc
              ? `${selected.quote.insurerName ?? selected.providerSlug} requires KYC before issuing the policy.`
              : "This provider does not require an extra KYC step for this journey."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {kycId ? (
            <p className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
              <BadgeCheck className="size-4" /> KYC complete.
            </p>
          ) : null}

          {supportsKyc ? (
            <>
              <p className="text-sm text-muted-foreground">
                PAN: <span className="font-medium text-foreground">{panNumber ?? "—"}</span>
              </p>
              <Button className="w-full" size="lg" onClick={runKyc} disabled={ckyc.isPending}>
                {ckyc.isPending ? (
                  <>
                    <Loader2 className="animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldAlert /> Verify KYC
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button className="w-full" size="lg" onClick={proceed}>
              Continue to payment <ArrowRight />
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
