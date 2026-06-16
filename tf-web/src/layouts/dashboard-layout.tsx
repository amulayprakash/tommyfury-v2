import { FileText, HeadsetIcon, UserRound, Wallet } from "lucide-react";
import { Suspense } from "react";
import { NavLink, Outlet } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { Footer } from "@/components/shared/footer";
import { Navbar } from "@/components/shared/navbar";
import { PageLoader } from "@/components/shared/page-loader";
import { cn } from "@/lib/utils";

const DASHBOARD_LINKS = [
  { label: "Profile", to: ROUTES.account.profile, icon: UserRound },
  { label: "My Policies", to: ROUTES.account.myPolicy, icon: FileText },
  { label: "Wallet", to: ROUTES.account.wallet, icon: Wallet },
  { label: "Support", to: ROUTES.account.support, icon: HeadsetIcon },
] as const;

/** Account area: navbar + sidebar (top tabs on mobile) + content. */
export function DashboardLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 lg:flex-row">
        <aside className="lg:w-56">
          <nav
            className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible"
            aria-label="Account"
          >
            {DASHBOARD_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                    isActive ? "bg-secondary text-primary" : "text-foreground/80",
                  )
                }
              >
                <link.icon className="size-4" aria-hidden />
                {link.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <Footer />
    </div>
  );
}
