import { ArrowRight, BadgeCheck, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFullQuote, useProviders } from "../api/hooks";
import type { MotorFullQuoteRequest } from "../api/types";
import { InspectionCard } from "../components/inspection-card";
import { PremiumBreakdown } from "../components/premium-breakdown";
import { WizardSteps } from "../components/wizard-steps";
import { PAN_REGEX } from "../lib/proposal-schema";
import { buildQuoteRequest, useVehicleQuoteStore } from "../vehicle-quote-store";

export function ReviewPage() {
  const navigate = useNavigate();
  const store = useVehicleQuoteStore();
  const { vehicle, selected, proposal, panNumber, ckyc, kycRefId, kycId, inspection } = store;
  const fullQuote = useFullQuote();
  const providers = useProviders();
  // Revealed when the backend rejects the proposal with INSPECTION_REQUIRED
  // (covers break-in rules the client-side detection below doesn't know).
  const [inspectionDemanded, setInspectionDemanded] = useState(false);

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

  // Break-in / PYP-skipped rollovers need a pre-inspection before the insurer
  // accepts the proposal (currently an FG rule; its provider declares the
  // "inspection" operation). Mirrors tf-api's inspectionRequired(): break-in is
  // DERIVED from the dates — an expired, unreadable, or missing previous expiry
  // counts, not just the RC-derived flag.
  const supportsInspection = provider?.operations.includes("inspection") ?? false;
  const isRollover = vehicle.businessType === "rollover" || vehicle.businessType === "renewal";
  const todayIso = new Date().toISOString().slice(0, 10);
  const breakInLikely =
    vehicle.isPreviousPolicyExpired ||
    !vehicle.previousPolicyNumber ||
    !vehicle.previousPolicyExpiryDate ||
    vehicle.previousPolicyExpiryDate < todayIso;
  // Third-party has an inspection waiver (FG applies the T+2 risk-start rule
  // instead), so the card only gates OD-bearing plans.
  const inspectionNeeded =
    (supportsInspection && isRollover && breakInLikely && store.planType !== "thirdParty") ||
    inspectionDemanded;
  const inspectionReady = !inspectionNeeded || Boolean(inspection?.reportNumber);

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
      // Break-in inspection evidence (FG rejects break-in proposals without it).
      ...(inspection
        ? { inspectionReportNumber: inspection.reportNumber, inspectionDate: inspection.date }
        : {}),
      // Echo the vendor's quote-time OD special discount — FG re-rates the
      // proposal WITHOUT it when omitted (payment premium jumps vs compare).
      ...(selected.quote.odDiscountPercent
        ? { odDiscountPercent: selected.quote.odDiscountPercent }
        : {}),
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
        onError: (err) => {
          if (apiErrorCode(err) === "INSPECTION_REQUIRED") setInspectionDemanded(true);
          toast.error(apiErrorMessage(err, "Could not generate the full quote."));
        },
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

        <div className="space-y-6">
          {inspectionNeeded ? <InspectionCard providerSlug={selected.providerSlug} /> : null}

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

              {!inspectionReady ? (
                <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <BadgeCheck className="mt-0.5 size-4 shrink-0" />
                  <span>
                    A vehicle inspection is required before this policy can be issued — complete
                    it in the card above.
                  </span>
                </div>
              ) : null}

              <Button
                size="lg"
                className="w-full"
                onClick={onProceed}
                disabled={fullQuote.isPending || !kycReady || !inspectionReady}
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
    </div>
  );
}
