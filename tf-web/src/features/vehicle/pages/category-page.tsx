import { Bike, Car, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRcLookup } from "../api/hooks";
import type { SupportedCategory } from "../api/types";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

const RC_REGEX = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{3,4}$/;

interface CategoryPageProps {
  category: SupportedCategory;
}

/** Step 1 — pick category (via route) and enter the vehicle number for RC lookup. */
export function CategoryPage({ category }: CategoryPageProps) {
  const navigate = useNavigate();
  const setRc = useVehicleQuoteStore((s) => s.setRc);
  const setCategory = useVehicleQuoteStore((s) => s.setCategory);
  const rcLookup = useRcLookup();

  const [rcNumber, setRcNumber] = useState("");
  const isCar = category === "fourWheeler";
  const Icon = isCar ? Car : Bike;
  const normalized = rcNumber.trim().toUpperCase().replace(/\s+/g, "");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!RC_REGEX.test(normalized)) {
      toast.error("Enter a valid registration number, e.g. MH12WW9836.");
      return;
    }
    rcLookup.mutate(normalized, {
      onSuccess: (rc) => {
        // Trust the detected category when the RC tells us something different.
        setCategory(rc.category ?? category);
        setRc(rc);
        void navigate(ROUTES.vehicle.confirmDetails);
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Could not fetch vehicle details."),
    });
  };

  return (
    <div>
      <WizardSteps current={0} />
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="size-6" />
          </div>
          <CardTitle>{isCar ? "Car Insurance" : "Two Wheeler Insurance"}</CardTitle>
          <CardDescription>
            Enter your vehicle number and we’ll fetch the registration details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={rcNumber}
                onChange={(e) => setRcNumber(e.target.value.toUpperCase())}
                placeholder="MH12WW9836"
                autoComplete="off"
                autoCapitalize="characters"
                className="pl-9 uppercase tracking-wider"
                aria-label="Vehicle registration number"
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={rcLookup.isPending}>
              {rcLookup.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> Fetching details…
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
