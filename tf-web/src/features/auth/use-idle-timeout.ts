import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ROUTES } from "@/app/router/paths";
import { env } from "@/lib/env";

import { useAuthStore } from "./auth-store";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "visibilitychange"] as const;
const ACTIVITY_THROTTLE_MS = 30_000;
const TICK_MS = 1_000;

export interface IdleTimeoutState {
  /** True when the session-expiry warning dialog should be visible. */
  warningOpen: boolean;
  secondsLeft: number;
  staySignedIn: () => void;
}

/**
 * Activity-based idle timeout (replaces the legacy 10-minute absolute timer).
 * Any interaction keeps the session alive; after VITE_IDLE_TIMEOUT_MIN of
 * inactivity the user is logged out, with a countdown warning shown 2 minutes
 * before that happens.
 */
export function useIdleTimeout(): IdleTimeoutState {
  const status = useAuthStore((state) => state.status);
  const navigate = useNavigate();
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const lastRecordedRef = useRef(0);

  const idleLimitMs = env.VITE_IDLE_TIMEOUT_MIN * 60_000;
  const warningWindowMs = Math.min(2 * 60_000, idleLimitMs / 2);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastRecordedRef.current < ACTIVITY_THROTTLE_MS) return;
      lastRecordedRef.current = now;
      useAuthStore.getState().recordActivity();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, recordActivity, { passive: true });
    }

    const interval = setInterval(() => {
      const { lastActivityAt, logout } = useAuthStore.getState();
      const remainingMs = idleLimitMs - (Date.now() - lastActivityAt);

      if (remainingMs <= 0) {
        logout("idle");
        setWarningOpen(false);
        toast.info("You were signed out after a period of inactivity.");
        void navigate(ROUTES.auth.login);
      } else if (remainingMs <= warningWindowMs) {
        setWarningOpen(true);
        setSecondsLeft(Math.ceil(remainingMs / 1000));
      } else {
        setWarningOpen(false);
      }
    }, TICK_MS);

    return () => {
      clearInterval(interval);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, recordActivity);
      }
    };
  }, [status, idleLimitMs, warningWindowMs, navigate]);

  return {
    // Derived rather than reset in the effect: a logout from anywhere closes the dialog.
    warningOpen: warningOpen && status === "authenticated",
    secondsLeft,
    staySignedIn: () => {
      useAuthStore.getState().recordActivity();
      lastRecordedRef.current = Date.now();
      setWarningOpen(false);
    },
  };
}
