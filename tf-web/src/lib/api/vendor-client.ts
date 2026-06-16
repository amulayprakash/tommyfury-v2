import axios from "axios";

import { env } from "@/lib/env";
import { attachAuthInterceptors } from "@/lib/api/interceptors";

/** Client for the new tf-api vendor quote service (multi-provider motor quotes). */
export const vendorClient = attachAuthInterceptors(
  axios.create({
    baseURL: env.VITE_VENDOR_API_URL,
    headers: { "Content-Type": "application/json" },
    timeout: 60_000,
  }),
);
