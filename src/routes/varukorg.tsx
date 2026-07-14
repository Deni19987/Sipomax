import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingCart, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ShopShell } from "@/components/shop/ShopShell";
import { CATEGORY_ICONS } from "@/components/shop/category-icons";
import { FREE_SHIPPING_THRESHOLD, formatPrice, getCategory, getProduct } from "@/lib/shop/catalog";
import { useCart } from "@/lib/shop/cart";
import { placeShopOrderFn } from "@/lib/shop-orders.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/varukorg")({
  ssr: false,
  component: CartPage,
});

function CartPage() {
  const { lines, total, setQuantity, removeFromCart, clearCart } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const placeOrder = useServerFn(placeShopOrderFn);
  const [sending, setSending] = useState(false);

  async function submitOrder() {
    if (sending || lines.length === 0) return;
    setSending(true);
    try {
      const order = await placeOrder({
        data: { items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) },
      });
      clearCart();
      queryClient.invalidateQueries({ queryKey: ["my-shop-orders"] });
      toast.success(`Beställning #${order.orderNumber} skickad!`);
      navigate({ to: "/bestallningar/$id", params: { id: order.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Beställningen kunde inte skickas.");
    } finally {
      setSending(false);
    }
  }

  const remainingToFreeShipping = FREE_SHIPPING_THRESHOLD - total;

  return (
    <ShopShell title="Varukorg" backTo="/">
      <div className="space-y-4 px-4 pt-4">
        {lines.length === 0 ? (
          <div className="rounded-xl bg-card p-8 text-center shadow-sm">
            <ShoppingCart className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold text-card-foreground">Din varukorg är tom</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Lägg till produkter så dyker de upp här.
            </p>
            <Link
              to="/produkter"
              search={{ kategori: undefined, q: undefined }}
              className="mt-4 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
            >
              Utforska produkter
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {lines.map((line) => {
                const product = getProduct(line.productId);
                if (!product) return null;
                const category = getCategory(product.category);
                const Icon = CATEGORY_ICONS[product.category];
                return (
                  <div
                    key={line.productId}
                    className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-sm"
                  >
                    <Link
                      to="/produkt/$id"
                      params={{ id: product.id }}
                      className={cn(
                        "flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
                        category?.gradient ?? "from-slate-700 to-slate-900",
                      )}
                    >
                      <Icon className="h-6 w-6 text-white/80" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-card-foreground">
                        {product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPrice(product.price)} · {product.unit}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="Minska antal"
                          onClick={() => setQuantity(line.productId, line.quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-bold text-card-foreground">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="Öka antal"
                          onClick={() => setQuantity(line.productId, line.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <p className="text-sm font-bold text-card-foreground">
                        {formatPrice(product.price * line.quantity)}
                      </p>
                      <button
                        type="button"
                        aria-label={`Ta bort ${product.name}`}
                        onClick={() => removeFromCart(line.productId)}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-neutral-900 p-4 text-white">
              <Truck className="h-6 w-6 shrink-0 text-primary" />
              <p className="text-sm">
                {remainingToFreeShipping > 0 ? (
                  <>
                    Handla för <b>{formatPrice(remainingToFreeShipping)}</b> till för fri frakt
                  </>
                ) : (
                  <b>Du har fri frakt på denna beställning!</b>
                )}
              </p>
            </div>

            <div className="rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Summa (exkl. moms)</span>
                <span>{formatPrice(total)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
                <span>Frakt</span>
                <span>{remainingToFreeShipping > 0 ? "Tillkommer" : "Fri frakt"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-bold text-card-foreground">
                <span>Totalt</span>
                <span>{formatPrice(total)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Beställningen faktureras via Fortnox enligt ert avtal med Sipomax.
              </p>
            </div>

            <button
              type="button"
              onClick={submitOrder}
              disabled={sending}
              className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {sending ? "Skickar…" : `Skicka beställning · ${formatPrice(total)}`}
            </button>
          </>
        )}
      </div>
    </ShopShell>
  );
}
