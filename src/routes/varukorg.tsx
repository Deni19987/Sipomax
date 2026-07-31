import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MapPin, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CartShippingBubble } from "@/components/shop/cards";
import { ShopShell } from "@/components/shop/ShopShell";
import { CATEGORY_ICONS } from "@/components/shop/category-icons";
import { FREE_SHIPPING_THRESHOLD, formatPrice, getCategory } from "@/lib/shop/catalog";
import { useCart } from "@/lib/shop/cart";
import { useShopExtras } from "@/lib/shop/use-shop-extras";
import { getMyDeliveryDetailsFn, placeShopOrderFn } from "@/lib/shop-orders.functions";
import {
  EMPTY_DELIVERY,
  describeMissingFields,
  missingDeliveryFields,
  normalizeDelivery,
  type DeliveryDetails,
} from "@/lib/shop/delivery";
import { cn } from "@/lib/utils";

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "tel";
  invalid?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={cn(
          "w-full rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground",
          invalid && "ring-2 ring-destructive",
        )}
      />
    </div>
  );
}

export const Route = createFileRoute("/varukorg")({
  ssr: false,
  component: CartPage,
});

function CartPage() {
  const { lines, total, setQuantity, removeFromCart, clearCart } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const placeOrder = useServerFn(placeShopOrderFn);
  const fetchDelivery = useServerFn(getMyDeliveryDetailsFn);
  const [sending, setSending] = useState(false);

  // Sparade uppgifter från kundkortet förifyller formuläret.
  const { data: savedDelivery } = useQuery({
    queryKey: ["my-delivery-details"],
    queryFn: () => fetchDelivery(),
  });
  const [delivery, setDelivery] = useState<DeliveryDetails>(EMPTY_DELIVERY);
  const [saveDetails, setSaveDetails] = useState(true);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (savedDelivery) setDelivery(savedDelivery.details);
  }, [savedDelivery]);

  const missing = missingDeliveryFields(delivery);

  async function submitOrder() {
    if (sending || lines.length === 0) return;
    if (missing.length > 0) {
      setShowErrors(true);
      toast.error(describeMissingFields(missing));
      return;
    }
    setSending(true);
    try {
      const order = await placeOrder({
        data: {
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          delivery: normalizeDelivery(delivery),
          saveDetails,
        },
      });
      clearCart();
      queryClient.invalidateQueries({ queryKey: ["my-shop-orders"] });
      queryClient.invalidateQueries({ queryKey: ["my-delivery-details"] });
      toast.success(`Beställning #${order.orderNumber} skickad!`);
      navigate({ to: "/bestallningar/$id", params: { id: order.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Beställningen kunde inte skickas.");
    } finally {
      setSending(false);
    }
  }

  function set(key: keyof DeliveryDetails, value: string) {
    setDelivery((prev) => ({ ...prev, [key]: value }));
  }

  // Aktiv frifrakt-kampanj styr gränsen; annars gäller standardgränsen.
  const { findProduct, getCampaign } = useShopExtras();
  const shippingCampaign = getCampaign("free_shipping");
  const freeShippingLimit = shippingCampaign?.minOrder ?? FREE_SHIPPING_THRESHOLD;
  const remainingToFreeShipping = freeShippingLimit - total;

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
                const product = findProduct(line.productId);
                const category = product ? getCategory(product.category) : undefined;
                const Icon = product ? CATEGORY_ICONS[product.category] : ShoppingCart;
                return (
                  <div
                    key={line.productId}
                    className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-sm"
                  >
                    <Link
                      to="/produkt/$id"
                      params={{ id: line.productId }}
                      className={cn(
                        "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br",
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
                        <Icon className="h-6 w-6 text-white/80" />
                      )}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-card-foreground">
                        {line.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPrice(line.unitPrice)}
                        {line.unit ? ` · ${line.unit}` : ""}
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
                        {formatPrice(line.unitPrice * line.quantity)}
                      </p>
                      <button
                        type="button"
                        aria-label={`Ta bort ${line.name}`}
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

            <CartShippingBubble
              minOrder={freeShippingLimit}
              title={shippingCampaign?.title}
              total={total}
            />

            <div className="rounded-xl bg-card p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-bold text-card-foreground">
                <MapPin className="h-4 w-4 text-primary" />
                Leveransuppgifter
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {savedDelivery?.saved
                  ? "Hämtat från ditt kundkort. Ändra om leveransen ska någon annanstans."
                  : "Vart ska beställningen levereras?"}
              </p>

              <div className="mt-3 space-y-2">
                <Field
                  label="Mottagare"
                  value={delivery.recipient}
                  onChange={(v) => set("recipient", v)}
                  placeholder="Företag eller person"
                  invalid={showErrors && missing.includes("recipient")}
                />
                <Field
                  label="Gatuadress"
                  value={delivery.street}
                  onChange={(v) => set("street", v)}
                  placeholder="Gata och nummer"
                  invalid={showErrors && missing.includes("street")}
                />
                <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
                  <Field
                    label="Postnummer"
                    value={delivery.postalCode}
                    onChange={(v) => set("postalCode", v)}
                    placeholder="123 45"
                    inputMode="numeric"
                    invalid={showErrors && missing.includes("postalCode")}
                  />
                  <Field
                    label="Ort"
                    value={delivery.city}
                    onChange={(v) => set("city", v)}
                    placeholder="Ort"
                    invalid={showErrors && missing.includes("city")}
                  />
                </div>
                <Field
                  label="Land"
                  value={delivery.country}
                  onChange={(v) => set("country", v)}
                  placeholder="Sverige"
                />
                <Field
                  label="Telefon vid leverans"
                  value={delivery.phone}
                  onChange={(v) => set("phone", v)}
                  placeholder="070-123 45 67"
                  inputMode="tel"
                  invalid={showErrors && missing.includes("phone")}
                />
                <Field
                  label="Leveransinstruktion (valfritt)"
                  value={delivery.note}
                  onChange={(v) => set("note", v)}
                  placeholder="T.ex. lastkaj på baksidan"
                />
              </div>

              <button
                type="button"
                onClick={() => setSaveDetails((prev) => !prev)}
                className="mt-4 flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                    saveDetails
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card",
                  )}
                >
                  {saveDetails && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-card-foreground">
                    Spara på mitt kundkort
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Uppgifterna fylls i automatiskt nästa gång du beställer.
                  </span>
                </span>
              </button>
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
