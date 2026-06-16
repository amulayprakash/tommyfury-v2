import { Navigate, Outlet, useLocation, useSearchParams } from "react-router";

import { PageLoader } from "@/components/shared/page-loader";
import { useAuthStore } from "@/features/auth/auth-store";

import { ROUTES } from "./paths";

/**
 * Layout-route guard: everything nested under it requires authentication.
 * While the persisted session is being restored a loader is shown instead of
 * flash-redirecting to /login (a bug in the legacy app).
 */
export function ProtectedRoute() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === "restoring") return <PageLoader />;
  if (status !== "authenticated") {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`${ROUTES.auth.login}?next=${next}`} replace />;
  }
  return <Outlet />;
}

/** Inverse guard for login pages: authenticated users are sent to `next` or home. */
export function PublicRoute() {
  const status = useAuthStore((state) => state.status);
  const [searchParams] = useSearchParams();

  if (status === "restoring") return <PageLoader />;
  if (status === "authenticated") {
    return <Navigate to={searchParams.get("next") ?? ROUTES.home} replace />;
  }
  return <Outlet />;
}
