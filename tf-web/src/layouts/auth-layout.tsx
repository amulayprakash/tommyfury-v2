import { Suspense } from "react";
import { Outlet } from "react-router";

import { Brand } from "@/components/shared/brand";
import { PageLoader } from "@/components/shared/page-loader";

/** Minimal chrome for login pages: brand on top, centered card, soft backdrop. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-secondary/60 to-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-5">
        <Brand />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
