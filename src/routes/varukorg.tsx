import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Minus, Plus, ShoppingCart, Trash2, Truck } from "lucide-react";
import { ShopShell } from "@/components/shop/ShopShell";
import { CATEGORY_ICONS } from "@/components/shop/category-icons";
import { FREE_SHIPPING_THRESHOLD, formatPrice, getCategory } from "@/lib/shop/catalog";
import { useCart } from "@/lib/shop/cart";
import { useShopExtras } from "@/lib/shop/use-shop-extras";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/varukorg")({
  ssr: false,
  component: CartPage,
});

function CartPage() {
  const { lines, total, itemCount, setQuantity, removeFromCart } = useCart();
  const navigate = useNavigate();

  // Aktiv frifrakt-kampanj styr gränsen; annars gäller standardgränsen.
  const { findProduct, getCampaign } = useShopExtras();
  const shippingCampaign = getCampaign("free_shipping");
  const freeShippingLimit = shippingCampaign?.minOrder ?? FREE_SHIPPING_THRESHOLD;
  const remaining = freeShippingLimit - total;
  const progress = Math.min(100, Math.round((total / freeShippingLimit) * 100));

  if (lines.length === 0) {
    return (
      <ShopShell title="Varukorg" backTo="/">
        <div className="px-4 pt-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <ShoppingCart className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="mt-4 text-base font-semibold text-foreground">Din varukorg är tom</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Lägg till produkter så dyker de upp här.
          </p>
          <Link
            to="/produkter"
            search={{ kategori: undefined, q: undefined }}
            className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground"
          >
            Utforska produkter
          </Link>
        </div>
      </ShopShell>
    );
  }

  return (
    <ShopShell
      title="Varukorg"
      subtitle={`${itemCount} ${itemCount === 1 ? "artikel" : "artiklar"}`}
      backTo="/"
      bottomBar={
        <>
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Att betala</span>
            <span className="text-lg font-bold text-foreground">{formatPrice(total)}</span>
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: "/kassa" })}
            className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
          >
            Till kassan
          </button>
        </>
      }
    >
      <div className="space-y-3 px-4 pt-3">
        {/* Fri frakt-mätare — standardinslag i svensk e-handel */}
        <div className="rounded-xl bg-card p-3.5 shadow-sm">
          <div className="flex items-center gap-2.5">
            <Truck className="h-5 w-5 shrink-0 text-primary" />
            <p className="flex-1 text-sm text-card-foreground">
              {remaining > 0 ? (
                <>
                  Handla för <span className="font-semibold">{formatPrice(remaining)}</span> till
                  för fri frakt
                </>
              ) : (
                <span className="font-semibold text-emerald-700">Du har fri frakt</span>
              )}
            </p>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                remaining > 0 ? "bg-primary" : "bg-emerald-600",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Produktrader */}
        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          {lines.map((line, index) => {
            const product = findProduct(line.productId);
            const category = product ? getCategory(product.category) : undefined;
            const Icon = product ? CATEGORY_ICONS[product.category] : ShoppingCart;
            return (
              <div
                key={line.productId}
                className={cn("flex gap-3 p-3.5", index > 0 && "border-t border-border")}
              >
                <Link
                  to="/produkt/$id"
                  params={{ id: line.productId }}
                  className={cn(
                    "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br",
                    category?.gradient ?? "from-slate-700 to-slate-900",
                  )}
                >
                  {product?.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={line.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Icon className="h-7 w-7 text-white/80" />
                  )}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to="/produkt/$id"
                      params={{ id: line.productId }}
                      className="min-w-0 flex-1 text-sm font-semibold leading-snug text-card-foreground"
                    >
                      {line.name}
                    </Link>
                    <button
                      type="button"
                      aria-label={`Ta bort ${line.name}`}
                      onClick={() => removeFromCart(line.productId)}
                      className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatPrice(line.unitPrice)}
                    {line.unit ? ` · ${line.unit}` : ""}
                  </p>

                  <div className="mt-auto flex items-center justify-between pt-2">
                    <div className="flex items-center rounded-lg border border-border">
                      <button
                        type="button"
                        aria-label="Minska antal"
                        onClick={() => setQuantity(line.productId, line.quantity - 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-l-lg text-foreground active:bg-muted"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums text-card-foreground">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="Öka antal"
                        onClick={() => setQuantity(line.productId, line.quantity + 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-r-lg text-foreground active:bg-muted"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-sm font-bold text-card-foreground">
                      {formatPrice(line.unitPrice * line.quantity)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <OrderSummary total={total} freeShipping={remaining <= 0} />

        <Link
          to="/produkter"
          search={{ kategori: undefined, q: undefined }}
          className="block py-1 text-center text-sm font-semibold text-primary"
        >
          Fortsätt handla
        </Link>
      </div>
    </ShopShell>
  );
}

/**
 * Summering enligt svensk standard: delsumma, frakt och moms specificerade var
 * för sig innan totalen. Att visa fraktkostnaden först i sista steget är den
 * vanligaste orsaken till avhopp, så den står här redan i varukorgen.
 */
export function OrderSummary({ total, freeShipping }: { total: number; freeShipping: boolean }) {
  const vat = Math.round(total * 0.25);
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="space-y-2 text-sm">
        <SummaryRow label="Delsumma" value={formatPrice(total)} />
        <SummaryRow label="Frakt" value={freeShipping ? "Fri frakt" : "Tillkommer"} />
        <SummaryRow label="Moms (25 %)" value={formatPrice(vat)} muted />
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
        <span className="text-base font-bold text-card-foreground">Att betala</span>
        <div className="text-right">
          <p className="text-lg font-bold text-card-foreground">{formatPrice(total)}</p>
          <p className="text-xs text-muted-foreground">{formatPrice(total + vat)} inkl. moms</p>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(muted ? "text-muted-foreground" : "font-medium text-card-foreground")}>
        {value}
      </span>
    </div>
  );
}
