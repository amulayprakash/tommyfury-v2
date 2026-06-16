import { Link } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Brand } from "@/components/shared/brand";

const FOOTER_SECTIONS = [
  {
    heading: "Insurance",
    links: [
      { label: "Two Wheeler", to: ROUTES.vehicle.start },
      { label: "Car", to: ROUTES.vehicle.carStart },
      { label: "Commercial Vehicle", to: ROUTES.vehicle.newCommercial },
      { label: "Health", to: ROUTES.health.start },
      { label: "Pet", to: ROUTES.pet.home },
    ],
  },
  {
    heading: "Pet Care",
    links: [
      { label: "Shop Services", to: ROUTES.petServices.shop },
      { label: "Custom Packages", to: ROUTES.petServices.createPackage },
      { label: "Service History", to: ROUTES.petServices.serviceHistory },
      { label: "Pet Tracking", to: ROUTES.petServices.petTracking },
    ],
  },
  {
    heading: "Policy Services",
    links: [
      { label: "My Policies", to: ROUTES.account.myPolicy },
      { label: "Claims", to: ROUTES.postSale.claimsIntimation },
      { label: "Renewals", to: ROUTES.postSale.renewals },
      { label: "Endorsements", to: ROUTES.postSale.endorsements },
      { label: "Grievance", to: ROUTES.postSale.grievance },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Help Center", to: ROUTES.account.support },
      { label: "Wallet", to: ROUTES.account.wallet },
      { label: "Terms & Conditions", to: ROUTES.termsAndConditions },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto w-full max-w-7xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-3 text-center sm:text-left">
            <Brand className="justify-center sm:justify-start" />
            <p className="text-sm text-muted-foreground">
              Insurance and pet care, together. Compare quotes from leading insurers and book
              trusted pet services near you.
            </p>
          </div>
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.heading} className="text-center sm:text-left">
              <h3 className="mb-3 text-sm font-semibold">{section.heading}</h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Tommy &amp; Furry. All rights reserved.</p>
          <p>IRDAI-registered insurance products are underwritten by the respective insurers.</p>
        </div>
      </div>
    </footer>
  );
}
