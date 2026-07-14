// Varukorg, lagrad i localStorage. Beställningar sparas i backend
// (shop_orders) via src/lib/shop-orders.functions.ts — varukorgen är bara
// det lokala arbetsläget innan en order skickas.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PRODUCTS, getProduct } from "./catalog";

const CART_KEY = "sipomax.cart.v1";

export interface CartLine {
  productId: string;
  quantity: number;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage full/otillgänglig — korgen lever vidare i minnet.
  }
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  total: number;
  addToCart: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function lineTotal(line: CartLine): number {
  const product = getProduct(line.productId);
  return product ? product.price * line.quantity : 0;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Släpp bara igenom produkter som fortfarande finns i katalogen.
    setLines(readJson<CartLine[]>(CART_KEY, []).filter((l) => getProduct(l.productId)));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeJson(CART_KEY, lines);
  }, [lines, hydrated]);

  const addToCart = useCallback((productId: string, quantity = 1) => {
    if (!getProduct(productId)) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + quantity } : l,
        );
      }
      return [...prev, { productId, quantity }];
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.productId !== productId)
        : prev.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
    );
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
    const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);
    return {
      lines,
      itemCount,
      total,
      addToCart,
      setQuantity,
      removeFromCart,
      clearCart,
    };
  }, [lines, addToCart, setQuantity, removeFromCart, clearCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart måste användas inuti <CartProvider>");
  return ctx;
}

export { PRODUCTS };
