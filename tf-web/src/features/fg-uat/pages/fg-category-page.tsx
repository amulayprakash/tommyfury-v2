import { useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProviders } from "../../vehicle/api/hooks";
import { CATEGORY_LABELS, fgCategories } from "../fg-capabilities";
import { useFgUatStore } from "../fg-uat-store";

/** Step 1 of the FG certification harness — pick one of the categories FG sells. */
export function FgCategoryPage() {
  const navigate = useNavigate();
  const providers = useProviders();
  const setCategory = useFgUatStore((s) => s.setCategory);
  const reset = useFgUatStore((s) => s.reset);

  const fg = providers.data?.find((p) => p.slug === "fg");
  const categories = fgCategories(fg);

  const choose = (category: string) => {
    reset();
    setCategory(category);
    void navigate(ROUTES.fgUat.vehicle);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Future Generali — UAT testing</h1>
        <p className="text-sm text-muted-foreground">
          Certification journey: quote → CKYC → proposal → payment → policy number.
        </p>
      </div>

      {providers.isPending ? (
        <p className="text-sm text-muted-foreground">Loading Future Generali capabilities…</p>
      ) : !fg ? (
        <p className="text-sm text-destructive">
          Future Generali is not registered. Check FG_ENABLED on the backend.
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
        Only the categories Future Generali sells are shown. Two-wheeler is not offered by this
        insurer.
      </p>
    </div>
  );
}
