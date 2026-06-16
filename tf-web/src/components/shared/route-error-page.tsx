import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { AlertTriangle } from "lucide-react";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";

/** Rendered by the router whenever a route throws (render error, 404, loader failure). */
export function RouteErrorPage() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="size-7 text-destructive" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        {isNotFound ? "Page not found" : "Something went wrong"}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {isNotFound
          ? "The page you are looking for doesn't exist or may have moved."
          : "An unexpected error occurred. Please try again, or head back home."}
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link to={ROUTES.home}>Back to home</Link>
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    </div>
  );
}
