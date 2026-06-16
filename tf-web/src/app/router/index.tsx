import { createBrowserRouter } from "react-router";

import { routes } from "./routes";

/**
 * Single switch point for routing strategy: if the hosting environment can't
 * rewrite all paths to index.html, swap createBrowserRouter for
 * createHashRouter here — nothing else in the app changes.
 */
export const router = createBrowserRouter(routes);
