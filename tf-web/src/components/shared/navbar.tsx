import { LogOut, Menu, UserRound, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { Brand } from "@/components/shared/brand";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth/auth-store";
import { useCartStore } from "@/features/cart/cart-store";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Vehicle Insurance", to: ROUTES.vehicle.start },
  { label: "Health Insurance", to: ROUTES.health.start },
  { label: "Pet Insurance", to: ROUTES.pet.home },
  { label: "Pet Services", to: ROUTES.petServices.shop },
  { label: "Claims", to: ROUTES.postSale.claimsIntimation },
  { label: "Renewals", to: ROUTES.postSale.renewals },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
    isActive ? "text-primary" : "text-foreground/80",
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const resetToGuest = useCartStore((state) => state.resetToGuest);

  const handleLogout = () => {
    logout("manual");
    resetToGuest();
    toast.success("You have been signed out.");
    void navigate(ROUTES.home);
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4">
        <Brand />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={navLinkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {status === "authenticated" && user ? (
            <div className="hidden items-center gap-1 sm:flex">
              <Button asChild variant="ghost" size="sm">
                <Link to={ROUTES.account.profile}>
                  <UserRound /> {user.name.split(" ")[0]}
                </Link>
              </Button>
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={handleLogout}>
                <LogOut />
              </Button>
            </div>
          ) : (
            <>
              <Button asChild size="sm" className="sm:hidden">
                <Link to={ROUTES.auth.signup}>Sign up</Link>
              </Button>
              <div className="hidden items-center gap-2 sm:flex">
                <Button asChild variant="ghost" size="sm">
                  <Link to={ROUTES.auth.login}>Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to={ROUTES.auth.signup}>Sign up</Link>
                </Button>
              </div>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <nav className="border-t px-4 py-3 lg:hidden" aria-label="Primary mobile">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={navLinkClass}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </NavLink>
            ))}
            <div className="mt-2 border-t pt-3">
              {status === "authenticated" && user ? (
                <div className="flex items-center justify-between">
                  <Button asChild variant="ghost" size="sm" onClick={() => setMobileOpen(false)}>
                    <Link to={ROUTES.account.profile}>
                      <UserRound /> {user.name.split(" ")[0]}
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLogout}>
                    <LogOut /> Sign out
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    asChild
                    variant="outline"
                    className="w-full"
                    onClick={() => setMobileOpen(false)}
                  >
                    <Link to={ROUTES.auth.login}>Sign in</Link>
                  </Button>
                  <Button asChild className="w-full" onClick={() => setMobileOpen(false)}>
                    <Link to={ROUTES.auth.signup}>Sign up</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
