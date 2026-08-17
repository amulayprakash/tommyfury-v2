import { useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProviders } from "../../vehicle/api/hooks";
import { CATEGORY_LABELS, hdfcCategories } from "../hdfc-capabilities";
import { useHdfcUatStore } from "../hdfc-uat-store";

/** Step 1 of the HDFC certification harness — pick one of the categories HDFC sells. */
export function HdfcCategoryPage() {
  const navigate = useNavigate();
  const providers = useProviders();
  const setCategory = useHdfcUatStore((s) => s.setCategory);
  const reset = useHdfcUatStore((s) => s.reset);

  const hdfc = providers.data?.find((p) => p.slug === "hdfc");
  const categories = hdfcCategories(hdfc);

  const choose = (category: string) => {
    reset();
    setCategory(category);
    void navigate(ROUTES.hdfcUat.vehicle);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">HDFC ERGO — UAT testing</h1>
        <p className="text-sm text-muted-foreground">
          Certification journey: quote → proposal → Pehchaan e-KYC → payment receipt → policy
          number.
        </p>
      </div>

      {providers.isPending ? (
        <p className="text-sm text-muted-foreground">Loading HDFC ERGO capabilities…</p>
      ) : !hdfc ? (
        <p className="text-sm text-destructive">
          HDFC ERGO is not registered. Check HDFC_ENABLED on the backend.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((c) => (
            <Card key={c}>
              <CardHeader>
                <CardTitle className="text-base">{CATEGORY_LABELS[c] ?? c}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => choose(c)}>
                  Start
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Only the categories HDFC ERGO declares are shown. Its kit ships a Private Car product only —
        no two-wheeler and no commercial line.
      </p>
    </div>
  );
}
