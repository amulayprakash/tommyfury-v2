import axios from "axios";

import { env } from "@/lib/env";
import { attachAuthInterceptors } from "@/lib/api/interceptors";

/** Client for the existing live Laravel API (auth, customers, cases, Zuno quotes, payments). */
export const legacyClient = attachAuthInterceptors(
  axios.create({
    baseURL: env.VITE_LEGACY_API_URL,
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
  }),
);
