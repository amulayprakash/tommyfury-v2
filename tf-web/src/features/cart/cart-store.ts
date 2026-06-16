import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const CART_STORAGE_KEY = "tf.cart.v1";
export const GUEST_OWNER_ID = "guest";

export interface CartItem {
  id: string;
  serviceId: string;
  name: string;
  price: number;
  quantity: number;
  date?: string;
  time?: string;
  petType?: string;
  packageName?: string;
}

/** Items are deduped on this key when a guest cart is merged into a user cart. */
function mergeKey(item: CartItem) {
  return [item.serviceId, item.packageName ?? "", item.date ?? "", item.time ?? ""].join("|");
}

interface CartState {
  /** Carts per owner survive logout, so a returning user finds their cart intact. */
  carts: Record<string, CartItem[]>;
  activeOwnerId: string;
  addItem: (item: Omit<CartItem, "id"> & { id?: string }) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<Omit<CartItem, "id">>) => void;
  clear: () => void;
  /** On login: merge whatever the guest collected into the user's saved cart. */
  adoptGuestCart: (userId: string) => void;
  /** On logout: switch back to (an empty) guest cart without touching user carts. */
  resetToGuest: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      carts: {},
      activeOwnerId: GUEST_OWNER_ID,
      addItem: (item) =>
        set((state) => {
          const id = item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const items = state.carts[state.activeOwnerId] ?? [];
          return {
            carts: {
              ...state.carts,
              [state.activeOwnerId]: [...items, { ...item, quantity: item.quantity || 1, id }],
            },
          };
        }),
      removeItem: (id) =>
        set((state) => ({
          carts: {
            ...state.carts,
            [state.activeOwnerId]: (state.carts[state.activeOwnerId] ?? []).filter(
              (item) => item.id !== id,
            ),
          },
        })),
      updateItem: (id, updates) =>
        set((state) => ({
          carts: {
            ...state.carts,
            [state.activeOwnerId]: (state.carts[state.activeOwnerId] ?? []).map((item) =>
              item.id === id ? { ...item, ...updates } : item,
            ),
          },
        })),
      clear: () =>
        set((state) => ({
          carts: { ...state.carts, [state.activeOwnerId]: [] },
        })),
      adoptGuestCart: (userId) =>
        set((state) => {
          const guestItems = state.carts[GUEST_OWNER_ID] ?? [];
          const userItems = state.carts[userId] ?? [];
          const existingKeys = new Set(userItems.map(mergeKey));
          const merged = [
            ...userItems,
            ...guestItems.filter((item) => !existingKeys.has(mergeKey(item))),
          ];
          return {
            activeOwnerId: userId,
            carts: { ...state.carts, [userId]: merged, [GUEST_OWNER_ID]: [] },
          };
        }),
      resetToGuest: () =>
        set((state) => ({
          activeOwnerId: GUEST_OWNER_ID,
          carts: { ...state.carts, [GUEST_OWNER_ID]: [] },
        })),
    }),
    {
      name: CART_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function useCartItems(): CartItem[] {
  return useCartStore((state) => state.carts[state.activeOwnerId]) ?? [];
}

export function useCartCount(): number {
  return useCartItems().reduce((sum, item) => sum + item.quantity, 0);
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
