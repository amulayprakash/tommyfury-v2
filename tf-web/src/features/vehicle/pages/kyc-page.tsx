import { ArrowRight, BadgeCheck, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCkyc, useProviders } from "../api/hooks";
import { WizardSteps } from "../components/wizard-steps";
import { PAN_REGEX } from "../lib/proposal-schema";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

export function KycPage() {
  const navigate = useNavigate();
  const selected = useVehicleQuoteStore((s) => s.selected);
  const proposal = useVehicleQuoteStore((s) => s.proposal);
  const kycId = useVehicleQuoteStore((s) => s.kycId);
  const setKyc = useVehicleQuoteStore((s) => s.setKyc);
  const setCkyc = useVehicleQuoteStore((s) => s.setCkyc);
  const setPan = useVehicleQuoteStore((s) => s.setPan);

  const providers = useProviders();
  const ckyc = useCkyc();
  const [pan, setPan_] = useState(useVehicleQuoteStore.getState().panNumber ?? "");
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // CKYC runs after the proposer details are captured and before the bound
  // proposal (FG flow: Quote → CKYC → Proposal).
  if (!selected || !proposal) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Fill in your details first.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.apiForm}>Back to details</Link>
        </Button>
      </div>
    );
  }

  const provider = providers.data?.find((p) => p.slug === selected.providerSlug);
  const supportsKyc = provider?.operations.includes("ckyc") ?? false;
  const panValid = PAN_REGEX.test(pan.trim().toUpperCase());

  const goToProposal = () => navigate(ROUTES.vehicle.coverage);

  const runKyc = () => {
    const panUpper = pan.trim().toUpperCase();
    ckyc.mutate(
      {
        provider: selected.providerSlug,
        req: {
          transactionId: selected.quote.transactionId ?? selected.quote.quoteNo ?? "kyc",
          dob: proposal.dob,
          panNumber: panValid ? panUpper : undefined,
          fullName: `${proposal.firstName} ${proposal.lastName}`.trim(),
          mobile: proposal.mobile,
          gender: proposal.gender,
          policyType: "motor",
          redirectUrl: `${window.location.origin}${ROUTES.vehicle.kycStatus}`,
        },
      },
      {
        onSuccess: (result) => {
          setPan(panUpper);
          if (result.isKycSuccess) {
            setCkyc(result.ckycNumber ?? null, result.ckycRefId ?? result.proposalId ?? null);
            setKyc(result.kycId ?? "verified");
            toast.success("KYC verified");
            void goToProposal();
          } else if (result.requiresRedirect && result.redirectUrl) {
            // No auto-match: keep the proposalId (→ CKYCRefNo) and surface the
            // hosted manual-KYC page; the user returns and continues.
            setCkyc(null, result.proposalId ?? null);
            setRedirectUrl(result.redirectUrl);
            toast.info("Please complete KYC verification to continue.");
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
    void goToProposal();
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
              <label className="block space-y-2">
                <span className="text-sm font-medium">PAN card number</span>
                <Input
                  value={pan}
                  onChange={(e) => setPan_(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  className="uppercase"
                />
                {pan && !panValid ? (
                  <span className="text-xs text-destructive">Enter a valid PAN (ABCDE1234F).</span>
                ) : null}
              </label>

              {redirectUrl ? (
                <div className="space-y-3">
                  <Button asChild variant="outline" className="w-full">
                    <a href={redirectUrl} target="_blank" rel="noreferrer">
                      Complete KYC verification <ExternalLink />
                    </a>
                  </Button>
                  <Button className="w-full" size="lg" onClick={goToProposal}>
                    I’ve completed KYC — continue <ArrowRight />
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={runKyc}
                  disabled={ckyc.isPending || !panValid}
                >
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
              )}
            </>
          ) : (
            <Button className="w-full" size="lg" onClick={proceed}>
              Continue <ArrowRight />
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
