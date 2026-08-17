import { AlertTriangle, ArrowRight, BadgeCheck, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { displayToIso, isoToDisplay } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { useCkyc } from "../../vehicle/api/hooks";
import type { CkycRequest, KycResult } from "../../vehicle/api/types";
import { Field } from "../components/condition-fields";
import { RawExchange } from "../components/raw-exchange";
import { HDFC_SLUG } from "../build-hdfc-request";
import { useHdfcUatStore } from "../hdfc-uat-store";

/**
 * Step 5 of the HDFC certification harness — Pehchaan e-KYC, which HDFC requires
 * before CreateProposal will accept the proposer.
 *
 * Two things about HDFC's UAT shape this page, both proved live:
 *
 * 1. Verification is HEADLESS. `POST /hdfc/kyc/ckyc` with a PAN comes back
 *    `isKycSuccess: true` with a `kycId` and no redirect at all, so the happy
 *    path is one button press. The `requiresRedirect` branch exists in the
 *    contract (Pehchaan answers with a `redirection_link` when it holds no
 *    record) and is handled below as the fallback — the hosted journey returns
 *    to this page with `?kycId=…`, which is fed straight back as `ckycNumber`;
 *    that is how Pehchaan's own status lookup is re-entered.
 * 2. The identity that comes back is POOLED TEST DATA. The same PAN returned
 *    "Rahul Automation" on one call and "Anmol Arora" on the next, and mobile
 *    and email came back empty. The proposal therefore takes its name and date
 *    of birth from the KYC record — that is what HDFC will match — so this page
 *    adopts them into the proposer and says plainly that it has, rather than
 *    letting a tester wonder why the proposal names a stranger.
 *
 * There is deliberately NO document-upload (OVD) tab, unlike FG's page: the
 * backend's HDFC `initiateOvd` throws NOT_IMPLEMENTED because the Pehchaan kit
 * ships no such API — documents are captured inside Pehchaan's own journey.
 *
 * Whatever HDFC says is shown verbatim. The tester's next action on a rejection
 * is to read HDFC's own words back to their team.
 */

/** Pehchaan returns dd/mm/yyyy; the app's canonical form is ISO. Accept either. */
function kycDobToIso(dob: string | undefined): string | undefined {
  if (!dob) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) return dob;
  return displayToIso(dob) ?? undefined;
}

/** "Rahul Automation" → first "Rahul", last "Automation" (last word is the surname). */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts.join(""), lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.slice(-1).join("") };
}

export function HdfcKycPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const quote = useHdfcUatStore((s) => s.quote);
  const proposer = useHdfcUatStore((s) => s.proposer);
  const ckycNumber = useHdfcUatStore((s) => s.ckyc);
  const kycRefId = useHdfcUatStore((s) => s.kycRefId);
  const exchanges = useHdfcUatStore((s) => s.exchanges);
  const setCkyc = useHdfcUatStore((s) => s.setCkyc);
  const setProposer = useHdfcUatStore((s) => s.setProposer);
  const recordExchange = useHdfcUatStore((s) => s.recordExchange);

  const ckyc = useCkyc();
  const [error, setError] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [identity, setIdentity] = useState<KycResult | null>(null);

  // HDFC keys the KYC record to the same transaction the quote was priced under.
  const transactionId = quote?.transactionId ?? quote?.quoteNo ?? "kyc";

  const run = (kycIdFromRedirect?: string) => {
    const req: CkycRequest = {
      transactionId,
      dob: proposer.dob,
      fullName: `${proposer.firstName} ${proposer.lastName}`.trim(),
      mobile: proposer.mobile,
      gender: proposer.gender,
      policyType: "motor",
      // Where Pehchaan sends the browser back to when it runs its hosted journey.
      redirectUrl: `${window.location.origin}${ROUTES.hdfcUat.kyc}`,
      // `ckycNumber` doubles as Pehchaan's kyc_id: sending the id the hosted
      // journey handed back re-enters the same lookup as a status poll.
      ...(kycIdFromRedirect
        ? { ckycNumber: kycIdFromRedirect }
        : { panNumber: proposer.panNumber.trim().toUpperCase() || undefined }),
    };
    setError(null);
    ckyc.mutate(
      { provider: HDFC_SLUG, req },
      {
        onSuccess: (result) => {
          recordExchange({
            step: "PehchaanKyc",
            at: new Date().toISOString(),
            request: req,
            response: result._rawResponse ?? result,
          });
          if (result.isKycSuccess && (result.kycId || result.ckycNumber)) {
            const id = result.ckycNumber ?? result.kycId ?? null;
            setCkyc(id, result.ckycRefId ?? result.kycId ?? null);
            setIdentity(result);
            setRedirectUrl(null);
            // The proposal is built from the KYC record, not from what was typed:
            // HDFC matches the proposer against the identity it just vouched for.
            const dob = kycDobToIso(result.dob);
            if (result.name || dob) {
              setProposer({
                ...proposer,
                ...(result.name ? splitName(result.name) : {}),
                ...(dob ? { dob } : {}),
              });
            }
            return;
          }
          if (result.requiresRedirect && result.redirectUrl) {
            // Never exercised on UAT — Pehchaan verified headlessly every time —
            // but this is the branch the contract documents, so it is wired.
            setCkyc(null, result.ckycRefId ?? result.proposalId ?? null);
            setRedirectUrl(result.redirectUrl);
          }
          setError(result.displayMessage ?? "HDFC returned no KYC id and no remark.");
        },
        onError: (err) => {
          const message = apiErrorMessage(err, "The e-KYC call failed before HDFC answered.");
          recordExchange({
            step: "PehchaanKyc",
            at: new Date().toISOString(),
            request: req,
            response: { code: apiErrorCode(err), message },
          });
          setError(message);
        },
      },
    );
  };

  // Coming back from Pehchaan's hosted journey: it appends ?kycId=… and that id
  // is fed straight back as `ckycNumber`. Guarded by a ref so a re-render (or the
  // mutation settling) cannot fire the lookup twice for the same id.
  const returnedKycId = params.get("kycId");
  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (!returnedKycId || resumed.current === returnedKycId) return;
    resumed.current = returnedKycId;
    run(returnedKycId);
    // `run` closes over the proposer and the mutation; re-running this effect on
    // every keystroke elsewhere would re-fire the lookup, which the ref and this
    // dependency list together prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedKycId]);

  if (!quote) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No quote captured yet — e-KYC is keyed to the quote&apos;s transaction id.
        </p>
        <Button asChild>
          <Link to={ROUTES.hdfcUat.start}>Start from /hdfc</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Pehchaan e-KYC</h1>
        <p className="text-sm text-muted-foreground">
          HDFC verifies the proposer through Pehchaan before CreateProposal will accept them. On
          UAT this resolves headlessly — no hosted journey, no redirect.
        </p>
      </div>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Identity submitted</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="PAN">
            <Input value={proposer.panNumber} readOnly className="uppercase" />
          </Field>
          <Field label="Date of birth">
            {/* Read-only mirror of the proposer step — dd/mm/yyyy, never a native date input. */}
            <Input value={isoToDisplay(proposer.dob)} readOnly />
          </Field>
          <Field label="Mobile">
            <Input value={proposer.mobile} readOnly />
          </Field>
          <Field label="Transaction id">
            <Input value={transactionId} readOnly />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Change any of these on the{" "}
          <Link to={ROUTES.hdfcUat.proposal} className="underline underline-offset-2">
            proposer step
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3 rounded-md border p-3">
        <h2 className="text-sm font-semibold">Result</h2>

        {ckycNumber ? (
          <div className="space-y-2 rounded-md bg-success/10 p-3 text-sm text-success">
            <p className="flex items-center gap-2 font-medium">
              <BadgeCheck className="size-4 shrink-0" /> KYC id {ckycNumber}
              {kycRefId && kycRefId !== ckycNumber ? ` · reference ${kycRefId}` : ""}
            </p>
          </div>
        ) : null}

        {identity ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Identity HDFC returned</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="text-right">{identity.name || "not returned"}</span>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Date of birth</span>
                <span className="text-right tabular-nums">
                  {isoToDisplay(kycDobToIso(identity.dob)) || identity.dob || "not returned"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Mobile</span>
                <span className="text-right tabular-nums">
                  {identity.phone || "empty (UAT returns none)"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Email</span>
                <span className="text-right">{identity.email || "empty (UAT returns none)"}</span>
              </div>
            </div>
            {/* Stated plainly, because it looks like a bug otherwise. */}
            <p className="text-xs text-muted-foreground">
              HDFC&apos;s UAT e-KYC hands back a <strong>pooled test identity</strong> that need not
              match the PAN submitted — the same PAN returned &ldquo;Rahul Automation&rdquo; on one
              call and &ldquo;Anmol Arora&rdquo; on the next, with mobile and email empty. The name
              and date of birth above have been adopted into the proposer, because the proposal has
              to carry the identity HDFC just vouched for. The mobile and email you typed are kept.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> HDFC&apos;s response
            </p>
            {/* Verbatim — a friendlier rewrite would destroy the evidence. */}
            <p className="whitespace-pre-wrap break-words text-sm text-destructive">{error}</p>
          </div>
        ) : null}

        {redirectUrl ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Pehchaan holds no verified record for this identity and wants its hosted journey.
              Finish there; it returns to this page with a <code>kycId</code>, which is picked up
              automatically.
            </p>
            {/* Same tab on purpose: the return trip carries ?kycId=… back here. */}
            <Button asChild variant="outline" className="w-full">
              <a href={redirectUrl}>
                Complete KYC on HDFC&apos;s Pehchaan page <ExternalLink />
              </a>
            </Button>
          </div>
        ) : null}

        <Button className="w-full" size="lg" onClick={() => run()} disabled={ckyc.isPending}>
          {ckyc.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Verifying…
            </>
          ) : (
            <>
              <ShieldCheck /> {ckycNumber ? "Verify again" : "Verify with Pehchaan"}
            </>
          )}
        </Button>
      </section>

      <Button
        size="lg"
        className="w-full"
        onClick={() => void navigate(ROUTES.hdfcUat.review)}
        disabled={!ckycNumber}
      >
        Continue <ArrowRight />
      </Button>

      <RawExchange exchanges={exchanges} />
    </div>
  );
}
