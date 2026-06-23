import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInr } from "@/lib/utils";
import { useInitiatePayment } from "../api/hooks";
import type { PaymentForm } from "../api/vehicle-api";
import { PremiumBreakdown } from "../components/premium-breakdown";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

/** Builds a transient hidden form and POSTs it to the insurer's hosted gateway. */
function submitGatewayForm({ url, fields }: PaymentForm) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function PaymentPage() {
  const selected = useVehicleQuoteStore((s) => s.selected);
  const fullQuote = useVehicleQuoteStore((s) => s.fullQuote);
  const proposal = useVehicleQuoteStore((s) => s.proposal);
  const initiate = useInitiatePayment();

  if (!selected || !fullQuote) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Complete KYC to proceed to payment.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.kycStatus}>Back to KYC</Link>
        </Button>
      </div>
    );
  }

  // Providers that return a hosted-checkout link (e.g. ICICI) use it directly.
  const paymentUrl = fullQuote.paymentUrl;
  const quoteNo = fullQuote.quoteNo ?? fullQuote.transactionId;

  const payViaGateway = () => {
    if (!quoteNo || !proposal) {
      toast.error("Missing proposal reference; please redo the proposal step.");
      return;
    }
    initiate.mutate(
      {
        provider: selected.providerSlug,
        body: {
          quoteNo,
          premiumAmount: fullQuote.grossPremium,
          firstName: proposal.firstName,
          lastName: proposal.lastName,
          mobile: proposal.mobile,
          email: proposal.email,
        },
      },
      {
        onSuccess: (form) => submitGatewayForm(form),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not start the payment."),
      },
    );
  };

  return (
    <div>
      <WizardSteps current={4} />
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CreditCard className="size-6" />
          </div>
          <CardTitle>Complete your payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <PremiumBreakdown quote={fullQuote} />

          {fullQuote.policyNumber ? (
            <p className="text-sm text-muted-foreground">
              Proposal reference:{" "}
              <span className="font-medium text-foreground">{fullQuote.policyNumber}</span>
            </p>
          ) : null}

          {paymentUrl ? (
            <Button asChild size="lg" className="w-full">
              <a href={paymentUrl}>
                Pay {formatInr(fullQuote.grossPremium)} <ExternalLink />
              </a>
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full"
              onClick={payViaGateway}
              disabled={initiate.isPending}
            >
              {initiate.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> Redirecting…
                </>
              ) : (
                <>
                  Pay {formatInr(fullQuote.grossPremium)} <ExternalLink />
                </>
              )}
            </Button>
          )}

          <p className="text-center text-xs text-muted-foreground">
            You’ll be redirected to the insurer’s secure payment page and returned here once done.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
