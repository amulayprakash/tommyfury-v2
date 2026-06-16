import {
  Bike,
  Car,
  Dog,
  HeartPulse,
  PawPrint,
  ShieldCheck,
  Sparkles,
  Truck,
  Umbrella,
  Zap,
} from "lucide-react";
import { Link } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/features/auth/auth-store";

const PRODUCTS = [
  {
    title: "Two Wheeler",
    description: "Comprehensive & third-party cover for bikes and scooters.",
    icon: Bike,
    to: ROUTES.vehicle.start,
  },
  {
    title: "Car",
    description: "Instant quotes with zero-dep, RSA and engine protect add-ons.",
    icon: Car,
    to: ROUTES.vehicle.carStart,
  },
  {
    title: "Commercial Vehicle",
    description: "Goods carriers, passenger vehicles and fleet cover.",
    icon: Truck,
    to: ROUTES.vehicle.newCommercial,
  },
  {
    title: "Health",
    description: "Individual and family floater plans from top insurers.",
    icon: HeartPulse,
    to: ROUTES.health.start,
  },
  {
    title: "Pet Insurance",
    description: "Cover vet bills, surgery and third-party liability for your pet.",
    icon: PawPrint,
    to: ROUTES.pet.home,
  },
  {
    title: "Pet Services",
    description: "Grooming, walking, training and vet visits at your doorstep.",
    icon: Dog,
    to: ROUTES.petServices.shop,
  },
] as const;

const TRUST_POINTS = [
  { icon: ShieldCheck, label: "IRDAI-registered insurers" },
  { icon: Zap, label: "Quotes in under a minute" },
  { icon: Umbrella, label: "Claims & renewals support" },
  { icon: Sparkles, label: "Trusted pet professionals" },
] as const;

export default function HomePage() {
  // Signed-in users land straight on the product picker — the marketing hero
  // and trust strip are only shown to guests.
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated");

  return (
    <div>
      {/* Hero */}
      {!isAuthenticated ? (
        <section className="bg-gradient-to-b from-secondary/70 to-background">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 lg:grid-cols-2 lg:py-24">
            <div className="flex flex-col items-center justify-center gap-6 text-center lg:items-start lg:text-left">
              <Badge variant="accent">Insurance + Pet Care, together</Badge>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                Protect what moves you.{" "}
                <span className="text-primary">And who walks beside you.</span>
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">
                Compare vehicle, health and pet insurance quotes from leading insurers — and book
                trusted grooming, walking and vet services for your furry family.
              </p>
              <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
                <Button asChild size="lg">
                  <Link to={ROUTES.vehicle.start}>Get an insurance quote</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to={ROUTES.petServices.shop}>Book pet services</Link>
                </Button>
              </div>
            </div>
            <div className="hidden items-center justify-center lg:flex">
              <div className="grid grid-cols-2 gap-4">
                {TRUST_POINTS.map((point) => (
                  <Card key={point.label} className="w-56">
                    <CardContent className="flex flex-col items-start gap-3 p-5">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-secondary">
                        <point.icon className="size-5 text-primary" aria-hidden />
                      </div>
                      <p className="text-sm font-medium">{point.label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Products */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16">
        <div className="mb-8 flex flex-col gap-2 text-center sm:text-left">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            What can we cover today?
          </h2>
          <p className="text-muted-foreground">
            Pick a product to start a quote — it takes less than a minute.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((product) => (
            <Link
              key={product.title}
              to={product.to}
              className="group rounded-xl border bg-card p-6 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md sm:text-left"
            >
              <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary transition-colors group-hover:bg-primary group-hover:text-primary-foreground sm:mx-0">
                <product.icon className="size-5 text-primary transition-colors group-hover:text-primary-foreground" />
              </div>
              <h3 className="mb-1 font-semibold">{product.title}</h3>
              <p className="text-sm text-muted-foreground">{product.description}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Trust strip (mobile) */}
      {!isAuthenticated ? (
        <section className="border-t bg-muted/40 lg:hidden">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-4 px-4 py-8">
            {TRUST_POINTS.map((point) => (
              <div
                key={point.label}
                className="flex items-center justify-center gap-2 text-sm sm:justify-start"
              >
                <point.icon className="size-4 shrink-0 text-primary" aria-hidden />
                <span>{point.label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
