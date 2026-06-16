import { beforeEach, describe, expect, it } from "vitest";

import { cartTotal, GUEST_OWNER_ID, useCartStore } from "../cart-store";

function addItem(name: string, price = 100, extra: Record<string, string> = {}) {
  useCartStore.getState().addItem({
    serviceId: name,
    name,
    price,
    quantity: 1,
    ...extra,
  });
}

function activeItems() {
  const state = useCartStore.getState();
  return state.carts[state.activeOwnerId] ?? [];
}

beforeEach(() => {
  localStorage.clear();
  useCartStore.setState({ carts: {}, activeOwnerId: GUEST_OWNER_ID });
});

describe("cart-store", () => {
  it("adds, updates and removes items for the active owner", () => {
    addItem("Grooming", 499);
    expect(activeItems()).toHaveLength(1);

    const id = activeItems()[0]!.id;
    useCartStore.getState().updateItem(id, { quantity: 3 });
    expect(activeItems()[0]!.quantity).toBe(3);

    useCartStore.getState().removeItem(id);
    expect(activeItems()).toHaveLength(0);
  });

  it("merges the guest cart into the user cart on login, deduping identical services", () => {
    addItem("Grooming", 499, { date: "2026-06-15" });
    addItem("Walking", 199);

    // The user already had "Grooming" for the same date saved from a past session.
    useCartStore.setState((state) => ({
      carts: {
        ...state.carts,
        "user-1": [
          {
            id: "old-1",
            serviceId: "Grooming",
            name: "Grooming",
            price: 499,
            quantity: 1,
            date: "2026-06-15",
          },
        ],
      },
    }));

    useCartStore.getState().adoptGuestCart("user-1");

    const state = useCartStore.getState();
    expect(state.activeOwnerId).toBe("user-1");
    const names = (state.carts["user-1"] ?? []).map((item) => item.name).sort();
    expect(names).toEqual(["Grooming", "Walking"]);
    expect(state.carts[GUEST_OWNER_ID]).toEqual([]);
  });

  it("keeps the user's cart saved after logout and starts a fresh guest cart", () => {
    useCartStore.getState().adoptGuestCart("user-2");
    addItem("Training", 999);

    useCartStore.getState().resetToGuest();

    const state = useCartStore.getState();
    expect(state.activeOwnerId).toBe(GUEST_OWNER_ID);
    expect(state.carts[GUEST_OWNER_ID]).toEqual([]);
    expect(state.carts["user-2"]).toHaveLength(1);
  });

  it("computes totals from price and quantity", () => {
    expect(
      cartTotal([
        { id: "1", serviceId: "a", name: "a", price: 100, quantity: 2 },
        { id: "2", serviceId: "b", name: "b", price: 50, quantity: 1 },
      ]),
    ).toBe(250);
  });
});
