import { Suspense } from "react";
import { Outlet } from "react-router";

import { Brand } from "@/components/shared/brand";
import { PageLoader } from "@/components/shared/page-loader";

/**
 * Slim chrome for multi-step insurance journeys: brand header, no footer or
 * distracting nav. The journey stepper renders inside each wizard's pages.
 */
export function WizardLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center px-4">
          <Brand />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
