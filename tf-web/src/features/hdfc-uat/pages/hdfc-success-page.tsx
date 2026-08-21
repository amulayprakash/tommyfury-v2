import { BadgeCheck, Copy, FileText, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { vendorClient } from "@/lib/api/vendor-client";
import { formatInr } from "@/lib/utils";
import { CoiUnavailableError, saveCoi, type CoiResponse } from "../coi-download";
import { RawExchange } from "../components/raw-exchange";
import { HDFC_SLUG } from "../build-hdfc-request";
import { useHdfcUatStore } from "../hdfc-uat-store";

/**
 * Step 8 of the HDFC certification harness — the bound policy number, which is
 * the single value the certification workbook records as proof a case passed.
 *
 * Unlike FG, nothing arrives here on a query string: HDFC has no gateway and no
 * callback, so the number was returned inline by the issuance call on the
 * previous step and is already in the store. If it is missing, the honest reason
 * is that issuance never returned one — not that a redirect went astray.
 */
export function HdfcSuccessPage() {
  const navigate = useNavigate();
  const policyNo = useHdfcUatStore((s) => s.policyNo);
  const proposal = useHdfcUatStore((s) => s.proposal);
  const proposalNumber = useHdfcUatStore((s) => s.proposalNumber);
  const exchanges = useHdfcUatStore((s) => s.exchanges);
  const reset = useHdfcUatStore((s) => s.reset);

  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!policyNo) return;
    void navigator.clipboard.writeText(policyNo);
    setCopied(true);
  };

  const runAnother = () => {
    reset();
    void navigate(ROUTES.hdfcUat.start);
  };

  const [coiState, setCoiState] = useState<"idle" | "fetching">("idle");
  const [coiError, setCoiError] = useState<string | null>(null);

  /**
   * Fetch the COI and save it as a PDF.
   *
   * The route is keyed by the POLICY number: HDFC's `getCertificate` puts the
   * path parameter straight into `Req_Policy_Document.Policy_Number` (see tf-api
   * `hdfc.provider.ts`). It answers with the document as base64 JSON rather than
   * a PDF stream, so a plain link just showed the tester ~477 KB of base64 in a
   * browser tab. The certification workbook wants the file itself filed against
   * the policy number, so this downloads it.
   */
  const fetchCoi = async (): Promise<void> => {
    if (!policyNo) return;
    setCoiState("fetching");
    setCoiError(null);
    try {
      const { data } = await vendorClient.get<{ response: CoiResponse }>(
        `/${HDFC_SLUG}/policy/${encodeURIComponent(policyNo)}/certificate`,
      );
      saveCoi(data.response, policyNo);
    } catch (err) {
      // HDFC's own words where we have them — this is a certification harness,
      // so a tester's next action is to read the failure back to their team.
      setCoiError(
        err instanceof CoiUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not fetch the certificate.",
      );
    } finally {
      setCoiState("idle");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">
          {policyNo ? "Policy issued" : "No policy number yet"}
        </h1>
        <p className="text-sm text-muted-foreground">
          The policy number below is what the certification workbook records for this case.
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-3">
        {policyNo ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <BadgeCheck className="size-4 shrink-0" /> HDFC ERGO issued this policy
            </p>
            <p className="break-all font-display text-3xl font-semibold tabular-nums">{policyNo}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copy}>
                <Copy /> {copied ? "Copied" : "Copy policy number"}
              </Button>
              <Button variant="outline" onClick={() => void fetchCoi()} disabled={coiState === "fetching"}>
                {coiState === "fetching" ? <Loader2 className="animate-spin" /> : <FileText />}
                {coiState === "fetching" ? "Fetching…" : "Download certificate (COI)"}
              </Button>
            </div>
            {coiError ? (
              <p className="text-sm text-destructive" role="alert">
                {coiError}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            HDFC returned no policy number. Its issuance call answers inline — there is no gateway
            and no callback — so either the receipt was never recorded, or HDFC answered
            <code> IN_PROGRESS</code>, which the payment step shows verbatim.
          </p>
        )}
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Proposal references</h2>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Proposal number</span>
          <span className="tabular-nums">{proposalNumber ?? "not returned"}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Gross premium</span>
          <span className="tabular-nums">
            {proposal ? formatInr(proposal.grossPremium) : "not returned"}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Quote number</span>
          <span className="tabular-nums">{proposal?.quoteNo ?? "not returned"}</span>
        </div>
      </section>

      <RawExchange exchanges={exchanges} />

      <div className="flex flex-wrap gap-2">
        <Button size="lg" className="flex-1" onClick={runAnother}>
          <RotateCcw /> Run another test case
        </Button>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <Link to={ROUTES.hdfcUat.payment}>Back to the receipt</Link>
        </Button>
      </div>
    </div>
  );
}
