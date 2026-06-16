import { Link } from "react-router";

import { ROUTES } from "@/app/router/paths";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <circle cx="11" cy="11" r="3" className="fill-accent" />
      <circle cx="21" cy="11" r="3" className="fill-accent" />
      <ellipse cx="16" cy="20" rx="6.5" ry="5.5" className="fill-accent" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link to={ROUTES.home} className={cn("flex items-center gap-2", className)}>
      <BrandMark />
      <span className="font-display text-lg font-bold tracking-tight">
        Tommy <span className="text-primary">&amp;</span> Furry
      </span>
    </Link>
  );
}
