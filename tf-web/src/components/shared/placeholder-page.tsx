import { Link } from "react-router";
import { Construction } from "lucide-react";

import { ROUTES } from "@/app/router/paths";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PlaceholderPageProps {
  title: string;
  description?: string;
  /** Vertical label shown as a chip, e.g. "Pet Insurance" */
  vertical?: string;
}

/**
 * Branded "coming soon" page used by every route that exists for parity with
 * the legacy app but whose flow has not been rebuilt yet.
 */
export function PlaceholderPage({ title, description, vertical }: PlaceholderPageProps) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
        <Construction className="size-7 text-primary" aria-hidden />
      </div>
      {vertical ? <Badge variant="secondary">{vertical}</Badge> : null}
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">
        {description ??
          "This section is being rebuilt with the new experience and will be available soon."}
      </p>
      <Button asChild variant="outline" className="mt-2">
        <Link to={ROUTES.home}>Back to home</Link>
      </Button>
    </div>
  );
}
