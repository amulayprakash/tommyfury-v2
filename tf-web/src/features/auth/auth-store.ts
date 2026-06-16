import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { User } from "@/types/legacy-api";

export const AUTH_STORAGE_KEY = "tf.auth.v1";

export type AuthStatus = "restoring" | "authenticated" | "guest";
export type LogoutReason = "manual" | "idle" | "expired";

export interface AuthSession {
  user: User;
  accessToken: string;
  tokenType: string;
  pospId: string | null;
  signupId: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  tokenType: string;
  pospId: string | null;
  signupId: string | null;
  lastActivityAt: number;
  status: AuthStatus;
  setSession: (session: AuthSession) => void;
  recordActivity: () => void;
  logout: (reason?: LogoutReason) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      tokenType: "Bearer",
      pospId: null,
      signupId: null,
      lastActivityAt: Date.now(),
      status: "restoring",
      setSession: (session) =>
        set({
          user: session.user,
          accessToken: session.accessToken,
          tokenType: session.tokenType,
          pospId: session.pospId,
          signupId: session.signupId,
          lastActivityAt: Date.now(),
          status: "authenticated",
        }),
      recordActivity: () => set({ lastActivityAt: Date.now() }),
      logout: () =>
        set({
          user: null,
          accessToken: null,
          pospId: null,
          signupId: null,
          status: "guest",
        }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // status is derived, never persisted — it is recomputed after hydration.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        tokenType: state.tokenType,
        pospId: state.pospId,
        signupId: state.signupId,
        lastActivityAt: state.lastActivityAt,
      }),
    },
  ),
);

function resolveStatusFromToken() {
  useAuthStore.setState((state) => ({
    status: state.accessToken ? "authenticated" : "guest",
  }));
}

// localStorage hydration is synchronous, so the session is already restored here.
resolveStatusFromToken();

// Cross-tab sync: a login/logout in another tab updates this one too.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_STORAGE_KEY) return;
    void Promise.resolve(useAuthStore.persist.rehydrate()).then(resolveStatusFromToken);
  });
}
