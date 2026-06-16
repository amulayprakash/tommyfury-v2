import axios, { type AxiosInstance } from "axios";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { useAuthStore } from "@/features/auth/auth-store";

// Guards against a burst of parallel 401s triggering multiple logouts/redirects.
let handlingUnauthorized = false;

export function attachAuthInterceptors(client: AxiosInstance) {
  client.interceptors.request.use((config) => {
    const { accessToken, signupId } = useAuthStore.getState();
    if (accessToken && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    if (signupId) {
      config.headers["X-SIGNUP-ID"] = signupId;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      if (
        axios.isAxiosError(error) &&
        error.response?.status === 401 &&
        Boolean(error.config?.headers?.Authorization) &&
        !handlingUnauthorized
      ) {
        handlingUnauthorized = true;
        useAuthStore.getState().logout("expired");
        toast.error("Your session has expired. Please log in again.");
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`${ROUTES.auth.login}?next=${encodeURIComponent(next)}`);
      }
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    },
  );

  return client;
}
