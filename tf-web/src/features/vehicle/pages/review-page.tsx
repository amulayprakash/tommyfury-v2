import { ArrowRight, BadgeCheck, Loader2, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { apiErrorMessage } from "@/lib/api/error-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFullQuote, useProviders } from "../api/hooks";
import type { MotorFullQuoteRequest } from "../api/types";
import { PremiumBreakdown } from "../components/premium-breakdown";
import { WizardSteps } from "../components/wizard-steps";
import { PAN_REGEX } from "../lib/proposal-schema";
import { buildQuoteRequest, useVehicleQuoteStore } from "../vehicle-quote-store";

export function ReviewPage() {
  const navigate = useNavigate();
  const store = useVehicleQuoteStore();
  const { vehicle, selected, proposal, panNumber, ckyc, kycRefId, kycId } = store;
  const fullQuote = useFullQuote();
  const providers = useProviders();

  if (!vehicle || !selected || !proposal) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Complete your details to review the quote.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.apiForm}>Back to details</Link>
        </Button>
      </div>
    );
  }

  const panUpper = (panNumber ?? "").trim().toUpperCase();
  const panValid = PAN_REGEX.test(panUpper);

  // Gate the proposal on completed KYC. FG's CreateProposal needs the resolved
  // CKYC *number* (else "CKYC error: No record exist."); ICICI links KYC by
  // TransactionId, so a completed KYC (kycId) is enough.
  const provider = providers.data?.find((p) => p.slug === selected.providerSlug);
  const requiresKyc = provider?.operations.includes("ckyc") ?? false;
  const needsCkycNumber = selected.providerSlug === "fg";
  const kycDone = needsCkycNumber ? Boolean(ckyc) : Boolean(kycId);
  const kycReady = !requiresKyc || kycDone;

  const onProceed = () => {
    if (!kycReady) {
      toast.error("Complete KYC verification before proceeding to payment.");
      void navigate(ROUTES.vehicle.kycStatus);
      return;
    }
    const base = buildQuoteRequest(store);
    if (!base) return;

    const req: MotorFullQuoteRequest = {
      ...base,
      quoteId: selected.quote.transactionId ?? selected.quote.quoteNo,
      proposer: {
        firstName: proposal.firstName,
        lastName: proposal.lastName,
        email: proposal.email,
        mobile: proposal.mobile,
        dob: proposal.dob,
        gender: proposal.gender,
        ...(panValid ? { panNumber: panUpper } : {}),
      },
      address: {
        addressLine1: proposal.addressLine1,
        addressLine2: proposal.addressLine2,
        city: proposal.city,
        state: proposal.state,
        pincode: proposal.pincode,
      },
      vehicle: {
        engineNumber: proposal.engineNumber,
        chassisNumber: proposal.chassisNumber,
        financeType: proposal.financeType,
        financierName: proposal.financierName,
      },
      nomineeName: proposal.nomineeName,
      nomineeRelation: proposal.nomineeRelation,
      nomineeAge: proposal.nomineeAge ? Number(proposal.nomineeAge) : undefined,
      // CKYC captured before this step flows into CreateProposal (Client block).
      ...(ckyc ? { ckyc } : {}),
      ...(kycRefId ? { kycRefId } : {}),
      isProposalOnly: false,
      isVehicleUnderLoan: proposal.financeType !== "none",
      successUrl: `${window.location.origin}${ROUTES.checkout.insurancePaymentSuccess}`,
      failureUrl: `${window.location.origin}${ROUTES.checkout.hdfcFailure}`,
    };

    fullQuote.mutate(
      { provider: selected.providerSlug, req },
      {
        onSuccess: (quote) => {
          store.setFullQuote(quote.transactionId ?? quote.quoteNo ?? req.quoteId, quote);
          void navigate(ROUTES.vehicle.paymentPage);
        },
        onError: (err) => toast.error(apiErrorMessage(err, "Could not generate the full quote.")),
      },
    );
  };

  return (
    <div>
      <WizardSteps current={3} />
      <div className="mx-auto grid max-w-3xl gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selected.quote.insurerName ?? selected.providerSlug} — Plan summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PremiumBreakdown quote={selected.quote} />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Review &amp; pay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {proposal.firstName} {proposal.lastName} · {proposal.mobile}
            </p>
            {panUpper ? (
              <p className="text-sm text-muted-foreground">
                PAN: <span className="font-medium text-foreground">{panUpper}</span>
              </p>
            ) : null}

            {!kycReady ? (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <BadgeCheck className="mt-0.5 size-4 shrink-0" />
                <span>
                  KYC isn’t verified yet. Complete KYC to confirm the policy.{" "}
                  <Link to={ROUTES.vehicle.kycStatus} className="font-medium underline">
                    Verify KYC
                  </Link>
                </span>
              </div>
            ) : null}

            <Button
              size="lg"
              className="w-full"
              onClick={onProceed}
              disabled={fullQuote.isPending || !kycReady}
            >
              {fullQuote.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> Generating quote…
                </>
              ) : (
                <>
                  <ShieldCheck /> Confirm &amp; proceed to payment <ArrowRight />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
