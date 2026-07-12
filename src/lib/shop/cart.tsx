// Varukorg + beställningar, lagrade i localStorage.
//
// Detta är v1 av beställningsflödet: allt sparas lokalt i kundens webbläsare.
// Nästa steg är att spara ordrar i backend och skapa Fortnox-fakturor via den
// befintliga integrationen i src/lib/fortnox.server.ts.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PRODUCTS, getProduct, type Product } from "./catalog";

const CART_KEY = "sipomax.cart.v1";
const ORDERS_KEY = "sipomax.orders.v1";

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface OrderLine extends CartLine {
  name: string;
  unitPrice: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  createdAt: string; // ISO
  lines: OrderLine[];
  total: number;
  status: "mottagen" | "behandlas" | "skickad" | "levererad";
}

export const ORDER_STATUS_LABELS: Record<Order["status"], string> = {
  mottagen: "Mottagen",
  behandlas: "Behandlas",
  skickad: "Skickad",
  levererad: "Levererad",
};

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
  orders: Order[];
  placeOrder: () => Order | null;
}

const CartContext = createContext<CartContextValue | null>(null);

function lineTotal(line: CartLine): number {
  const product = getProduct(line.productId);
  return product ? product.price * line.quantity : 0;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Släpp bara igenom produkter som fortfarande finns i katalogen.
    setLines(readJson<CartLine[]>(CART_KEY, []).filter((l) => getProduct(l.productId)));
    setOrders(readJson<Order[]>(ORDERS_KEY, []));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeJson(CART_KEY, lines);
  }, [lines, hydrated]);

  useEffect(() => {
    if (hydrated) writeJson(ORDERS_KEY, orders);
  }, [orders, hydrated]);

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

  const placeOrder = useCallback((): Order | null => {
    if (lines.length === 0) return null;
    const orderLines: OrderLine[] = lines.map((l) => {
      const product = getProduct(l.productId) as Product;
      return { ...l, name: product.name, unitPrice: product.price };
    });
    const total = orderLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const orderNumber = orders.reduce((max, o) => Math.max(max, o.orderNumber), 10000) + 1;
    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber,
      createdAt: new Date().toISOString(),
      lines: orderLines,
      total,
      status: "mottagen",
    };
    setOrders((prev) => [order, ...prev]);
    setLines([]);
    return order;
  }, [lines, orders]);

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
      orders,
      placeOrder,
    };
  }, [lines, orders, addToCart, setQuantity, removeFromCart, clearCart, placeOrder]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart måste användas inuti <CartProvider>");
  return ctx;
}

export function getOrder(orders: Order[], id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export { PRODUCTS };
