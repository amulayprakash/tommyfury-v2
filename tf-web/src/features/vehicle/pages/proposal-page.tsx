import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { proposalSchema, type ProposalValues } from "../lib/proposal-schema";
import { WizardSteps } from "../components/wizard-steps";
import { useVehicleQuoteStore } from "../vehicle-quote-store";

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ProposalPage() {
  const navigate = useNavigate();
  const vehicle = useVehicleQuoteStore((s) => s.vehicle);
  const rc = useVehicleQuoteStore((s) => s.rc);
  const selected = useVehicleQuoteStore((s) => s.selected);
  const saved = useVehicleQuoteStore((s) => s.proposal);
  const setProposal = useVehicleQuoteStore((s) => s.setProposal);

  const [firstName, ...rest] = (rc?.ownerName ?? "").split(/\s+/).filter(Boolean);

  const form = useForm<ProposalValues>({
    resolver: zodResolver(proposalSchema),
    defaultValues: saved ?? {
      firstName: firstName ?? "",
      lastName: rest.join(" ") ?? "",
      email: "",
      mobile: "",
      dob: "",
      gender: undefined,
      addressLine1: rc?.presentAddress ?? "",
      addressLine2: "",
      city: vehicle?.city ?? "",
      state: vehicle?.state ?? "",
      pincode: rc?.pincode ?? "",
      engineNumber: vehicle?.engineNumber ?? "",
      chassisNumber: vehicle?.chassisNumber ?? "",
      financeType: "none",
      financierName: "",
      nomineeName: "",
      nomineeRelation: "",
      nomineeAge: "",
    },
  });

  if (!vehicle || !selected) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-4 text-muted-foreground">Choose a plan before filling your details.</p>
        <Button asChild>
          <Link to={ROUTES.vehicle.quotes}>Back to plans</Link>
        </Button>
      </div>
    );
  }

  const onSubmit = (values: ProposalValues) => {
    setProposal(values);
    void navigate(ROUTES.vehicle.coverage);
  };

  const text = (
    name: keyof ProposalValues,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} value={(field.value as string) ?? ""} {...props} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div>
      <WizardSteps current={2} />
      <Form {...form}>
        <form className="mx-auto max-w-2xl space-y-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proposer details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {text("firstName", "First name")}
              {text("lastName", "Last name")}
              {text("mobile", "Mobile number", { type: "tel", inputMode: "numeric", maxLength: 10 })}
              {text("email", "Email", { type: "email" })}
              {text("dob", "Date of birth", { type: "date" })}
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <FormControl>
                      <select {...field} value={field.value ?? ""} className={SELECT_CLASS}>
                        <option value="">Select</option>
                        <option value="M">Male</option>
                        <option value="F">Female</option>
                        <option value="O">Other</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Address</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">{text("addressLine1", "Address line 1")}</div>
              <div className="sm:col-span-2">{text("addressLine2", "Address line 2 (optional)")}</div>
              {text("city", "City")}
              {text("state", "State")}
              {text("pincode", "Pincode", { type: "tel", inputMode: "numeric", maxLength: 6 })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vehicle & nominee</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {text("engineNumber", "Engine number")}
              {text("chassisNumber", "Chassis number")}
              <FormField
                control={form.control}
                name="financeType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Finance</FormLabel>
                    <FormControl>
                      <select {...field} className={SELECT_CLASS}>
                        <option value="none">Not financed</option>
                        <option value="hypothecation">Hypothecation</option>
                        <option value="lease">Lease</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {text("financierName", "Financier (optional)")}
              {text("nomineeName", "Nominee name (optional)")}
              {text("nomineeRelation", "Nominee relation (optional)")}
              {text("nomineeAge", "Nominee age (optional)", { type: "number", inputMode: "numeric" })}
            </CardContent>
          </Card>

          <Button type="submit" size="lg" className="w-full">
            Get full quote <ArrowRight />
          </Button>
        </form>
      </Form>
    </div>
  );
}
