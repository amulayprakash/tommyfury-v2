import { Outlet, ScrollRestoration } from "react-router";

import { SessionManager } from "@/features/auth/session-manager";

import { HashRedirect } from "./hash-redirect";

/** Innermost shell common to every page: hash-link shim, idle-session manager, scroll reset. */
export function RootLayout() {
  return (
    <>
      <HashRedirect />
      <SessionManager />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
