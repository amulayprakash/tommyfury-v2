import { beforeEach, describe, expect, it } from "vitest";

import { AUTH_STORAGE_KEY, useAuthStore } from "../auth-store";
import type { AuthSession } from "../auth-store";

const session: AuthSession = {
  user: {
    id: "42",
    name: "Asha Rao",
    email: "asha@example.com",
    mobile: "9876543210",
    address: null,
    pincode: "400001",
  },
  accessToken: "token-abc",
  tokenType: "Bearer",
  pospId: "posp-1",
  signupId: "42",
};

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    pospId: null,
    signupId: null,
    status: "guest",
  });
});

describe("auth-store", () => {
  it("setSession stores the session and marks the user authenticated", () => {
    useAuthStore.getState().setSession(session);

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.user?.name).toBe("Asha Rao");
    expect(state.accessToken).toBe("token-abc");
    expect(state.signupId).toBe("42");
  });

  it("persists the session under a single storage key, without the derived status", () => {
    useAuthStore.getState().setSession(session);

    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(persisted.state["accessToken"]).toBe("token-abc");
    expect(persisted.state["status"]).toBeUndefined();
  });

  it("logout clears the session and returns to guest", () => {
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().logout("manual");

    const state = useAuthStore.getState();
    expect(state.status).toBe("guest");
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.pospId).toBeNull();
  });

  it("recordActivity bumps lastActivityAt", () => {
    useAuthStore.setState({ lastActivityAt: 0 });
    useAuthStore.getState().recordActivity();
    expect(useAuthStore.getState().lastActivityAt).toBeGreaterThan(0);
  });
});
