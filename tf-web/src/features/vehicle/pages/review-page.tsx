import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFullQuote } from "../api/hooks";
import type { MotorFullQuoteRequest } from "../api/types";
import { PremiumBreakdown } from "../components/premium-breakdown";
import { WizardSteps } from "../components/wizard-steps";
import { PAN_REGEX } from "../lib/proposal-schema";
import { buildQuoteRequest, useVehicleQuoteStore } from "../vehicle-quote-store";

export function ReviewPage() {
  const navigate = useNavigate();
  const store = useVehicleQuoteStore();
  const { vehicle, selected, proposal } = store;
  const fullQuote = useFullQuote();
  const [pan, setPan] = useState(store.panNumber ?? "");

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

  const panValid = PAN_REGEX.test(pan.trim().toUpperCase());

  const onProceed = () => {
    const base = buildQuoteRequest(store);
    if (!base) return;
    const panUpper = pan.trim().toUpperCase();

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
      isProposalOnly: false,
      isVehicleUnderLoan: proposal.financeType !== "none",
      successUrl: `${window.location.origin}${ROUTES.checkout.insurancePaymentSuccess}`,
      failureUrl: `${window.location.origin}${ROUTES.checkout.hdfcFailure}`,
    };

    fullQuote.mutate(
      { provider: selected.providerSlug, req },
      {
        onSuccess: (quote) => {
          store.setPan(panUpper);
          store.setFullQuote(quote.transactionId ?? quote.quoteNo ?? req.quoteId, quote);
          void navigate(ROUTES.vehicle.kycStatus);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not generate the full quote."),
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
            <label className="block space-y-2">
              <span className="text-sm font-medium">PAN card number</span>
              <Input
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                maxLength={10}
                className="uppercase"
              />
              {pan && !panValid ? (
                <span className="text-xs text-destructive">Enter a valid PAN (ABCDE1234F).</span>
              ) : null}
            </label>

            <Button
              size="lg"
              className="w-full"
              onClick={onProceed}
              disabled={fullQuote.isPending || !panValid}
            >
              {fullQuote.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> Generating quote…
                </>
              ) : (
                <>
                  <ShieldCheck /> Proceed to KYC <ArrowRight />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
