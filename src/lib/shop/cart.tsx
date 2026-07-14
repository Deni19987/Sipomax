// Varukorg, lagrad i localStorage. Beställningar sparas i backend
// (shop_orders) via src/lib/shop-orders.functions.ts — varukorgen är bara
// det lokala arbetsläget innan en order skickas.
//
// Raderna är denormaliserade (namn/pris/enhet sparas med raden) så att både
// den statiska katalogen och verkstadens egna produkter kan ligga i korgen.
// Servern räknar alltid om priserna vid beställning.

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

const CART_KEY = "sipomax.cart.v2";

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  unit: string | null;
  quantity: number;
}

// Det en produkt minst behöver för att kunna läggas i korgen.
export interface CartProductInput {
  id: string;
  name: string;
  price: number;
  unit?: string | null;
}

function readCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CartLine[];
      return parsed.filter(
        (l) => l && typeof l.productId === "string" && typeof l.unitPrice === "number",
      );
    }
    // Migrera gamla v1-korgar ({productId, quantity}) via statiska katalogen.
    const oldRaw = window.localStorage.getItem("sipomax.cart.v1");
    if (oldRaw) {
      const old = JSON.parse(oldRaw) as Array<{ productId: string; quantity: number }>;
      window.localStorage.removeItem("sipomax.cart.v1");
      return old.flatMap((l) => {
        const product = getProduct(l.productId);
        return product
          ? [
              {
                productId: product.id,
                name: product.name,
                unitPrice: product.price,
                unit: product.unit,
                quantity: l.quantity,
              },
            ]
          : [];
      });
    }
    return [];
  } catch {
    return [];
  }
}

function writeCart(lines: CartLine[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
  } catch {
    // localStorage full/otillgänglig — korgen lever vidare i minnet.
  }
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  total: number;
  addToCart: (product: CartProductInput, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLines(readCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeCart(lines);
  }, [lines, hydrated]);

  const addToCart = useCallback((product: CartProductInput, quantity = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + quantity } : l,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.price,
          unit: product.unit ?? null,
          quantity,
        },
      ];
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
    const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
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
