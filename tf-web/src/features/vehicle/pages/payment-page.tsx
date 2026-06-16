import { CreditCard, ExternalLink } from "lucide-react";
import { Link } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInr } from "@/lib/utils";
import { PremiumBreakdown } from "../components/premium-breakdown";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

export function PaymentPage() {
  const selected = useVehicleQuoteStore((s) => s.selected);
  const fullQuote = useVehicleQuoteStore((s) => s.fullQuote);

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

  const paymentUrl = fullQuote.paymentUrl;

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
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              The payment link from {selected.quote.insurerName ?? selected.providerSlug} isn’t
              available yet. Please retry shortly.
            </p>
          )}

          <p className="text-center text-xs text-muted-foreground">
            You’ll be redirected to the insurer’s secure payment page and returned here once done.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
