import { Suspense } from "react";
import { Outlet } from "react-router";

import { Footer } from "@/components/shared/footer";
import { Navbar } from "@/components/shared/navbar";
import { PageLoader } from "@/components/shared/page-loader";

/** Default site chrome: sticky navbar, page content, footer. */
export function MainLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <main className="flex-1">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
