import { BadgeCheck, Home } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Payment-gateway return target (FG redirects the browser here after issuance).
 * The real PolicyNo and quote reference arrive as query params on the callback
 * redirect (see tf-api payment.service `successRedirect`).
 */
export function PolicySuccessPage() {
  const [params] = useSearchParams();
  const policyNo = params.get("policyNo");
  const quoteNo = params.get("quoteNo");

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
            <BadgeCheck className="size-6" />
          </div>
          <CardTitle>{policyNo ? "Policy issued" : "Payment received"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {policyNo ? (
            <p className="text-sm text-muted-foreground">
              Your policy number is{" "}
              <span className="font-semibold text-foreground">{policyNo}</span>.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your payment was received. The policy document will be available shortly
              {quoteNo ? ` (reference ${quoteNo})` : ""}.
            </p>
          )}
          <Button asChild className="w-full">
            <Link to={ROUTES.home}>
              <Home /> Back to home
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
