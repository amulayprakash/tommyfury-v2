import { BadgeCheck, Copy, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { RawExchange } from "../components/raw-exchange";
import { useFgUatStore } from "../fg-uat-store";

/**
 * Step 8 of the FG certification harness — the PolicyNo, which is the single
 * value the certification workbook records as proof a case passed.
 *
 * The number is issued by the backend's payment callback, not by this page: FG's
 * gateway posts its result to `/api/v1/fg/payment/callback`, which issues the
 * policy and redirects the browser back with `?policyNo=…` (see tf-api
 * `payment.service` `successRedirect`). That redirect target is
 * `FG_PAYMENT_SUCCESS_URL`, so it has to be set to this page for the number to
 * arrive at all — hence both the query-param pickup below and the plain
 * statement when nothing came back.
 */
export function FgSuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const policyNo = useFgUatStore((s) => s.policyNo);
  const proposal = useFgUatStore((s) => s.proposal);
  const exchanges = useFgUatStore((s) => s.exchanges);
  const setPolicyNo = useFgUatStore((s) => s.setPolicyNo);
  const reset = useFgUatStore((s) => s.reset);

  const [copied, setCopied] = useState(false);

  // The callback hands the issued number back on the URL; park it in the store so
  // a reload (or the drawer's copied JSON) still carries it.
  const returned = params.get("policyNo");
  useEffect(() => {
    if (returned && returned !== policyNo) setPolicyNo(returned);
  }, [returned, policyNo, setPolicyNo]);

  const contract = proposal?.contractDetails ?? {};
  const clientId = typeof contract.clientId === "string" ? contract.clientId : null;
  const quotationNo =
    typeof contract.quotationNo === "string" && contract.quotationNo
      ? contract.quotationNo
      : (proposal?.quoteNo ?? proposal?.transactionId ?? null);

  const copy = () => {
    if (!policyNo) return;
    void navigator.clipboard.writeText(policyNo);
    setCopied(true);
  };

  const runAnother = () => {
    reset();
    void navigate(ROUTES.fgUat.start);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">
          {policyNo ? "Policy issued" : "No policy number yet"}
        </h1>
        <p className="text-sm text-muted-foreground">
          The PolicyNo below is what the certification workbook records for this case.
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-3">
        {policyNo ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <BadgeCheck className="size-4 shrink-0" /> FG issued this policy
            </p>
            <p className="break-all font-display text-3xl font-semibold tabular-nums">{policyNo}</p>
            <Button variant="outline" onClick={copy}>
              <Copy /> {copied ? "Copied" : "Copy policy number"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            FG has not returned a policy number to this page. It is issued by the payment callback
            (<code>/api/v1/fg/payment/callback</code>), which redirects back with{" "}
            <code>?policyNo=…</code> — so either payment has not completed, or the backend&apos;s{" "}
            <code>FG_PAYMENT_SUCCESS_URL</code> does not point at <code>/fg/success</code>.
          </p>
        )}
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Proposal references</h2>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">ClientId</span>
          <span className="tabular-nums">{clientId ?? "not returned"}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">QuotationNo</span>
          <span className="tabular-nums">{quotationNo ?? "not returned"}</span>
        </div>
      </section>

      <RawExchange exchanges={exchanges} />

      <Button size="lg" className="w-full" onClick={runAnother}>
        <RotateCcw /> Run another test case
      </Button>
    </div>
  );
}
