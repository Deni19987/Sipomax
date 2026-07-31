import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FileText, Package, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shop/form-field";
import { ShopShell } from "@/components/shop/ShopShell";
import { FREE_SHIPPING_THRESHOLD, formatPrice } from "@/lib/shop/catalog";
import { useCart } from "@/lib/shop/cart";
import { useShopExtras } from "@/lib/shop/use-shop-extras";
import { getMyDeliveryDetailsFn, placeShopOrderFn } from "@/lib/shop-orders.functions";
import {
  EMPTY_DELIVERY,
  missingDeliveryFields,
  normalizeDelivery,
  type DeliveryDetails,
} from "@/lib/shop/delivery";
import { cn } from "@/lib/utils";
import { OrderSummary } from "./varukorg";

/**
 * Kassan följer det upplägg svenska e-handlare använder: ett steg, en spalt,
 * hopfälld ordersammanfattning högst upp, leveransuppgifter i mitten, och en
 * klibbig knapp med totalsumman längst ned. Bottenmenyn döljs — färre utgångar
 * i kassan är den vanligaste rekommendationen för att minska avhopp.
 */
export const Route = createFileRoute("/kassa")({
  ssr: false,
  component: CheckoutPage,
});

function CheckoutPage() {
  const { lines, total, itemCount, clearCart } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const placeOrder = useServerFn(placeShopOrderFn);
  const fetchDelivery = useServerFn(getMyDeliveryDetailsFn);

  const { getCampaign } = useShopExtras();
  const freeShippingLimit = getCampaign("free_shipping")?.minOrder ?? FREE_SHIPPING_THRESHOLD;

  const { data: saved } = useQuery({
    queryKey: ["my-delivery-details"],
    queryFn: () => fetchDelivery(),
  });

  const [delivery, setDelivery] = useState<DeliveryDetails>(EMPTY_DELIVERY);
  const [saveDetails, setSaveDetails] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    if (saved) setDelivery(saved.details);
  }, [saved]);

  // Tom varukorg hör inte hemma i kassan.
  useEffect(() => {
    if (lines.length === 0 && !sending) navigate({ to: "/varukorg", replace: true });
  }, [lines.length, sending, navigate]);

  const missing = missingDeliveryFields(delivery);
  const errorFor = (key: keyof DeliveryDetails) =>
    showErrors && missing.includes(key) ? "Fyll i det här fältet" : null;

  function set(key: keyof DeliveryDetails, value: string) {
    setDelivery((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (sending) return;
    if (missing.length > 0) {
      setShowErrors(true);
      document.getElementById("leveransadress")?.scrollIntoView({ behavior: "smooth" });
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
      setSending(false);
    }
  }

  return (
    <ShopShell
      title="Kassa"
      backTo="/varukorg"
      hideNav
      bottomBar={
        <>
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Att betala</span>
            <span className="text-lg font-bold text-foreground">{formatPrice(total)}</span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={sending}
            className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60"
          >
            {sending ? "Skickar…" : "Slutför beställning"}
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Genom att slutföra beställningen godkänner du Sipomax köpvillkor.
          </p>
        </>
      }
    >
      <div className="space-y-3 px-4 pt-3">
        {/* Hopfälld ordersammanfattning — innehållet är redan granskat i korgen */}
        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          <button
            type="button"
            onClick={() => setSummaryOpen((prev) => !prev)}
            aria-expanded={summaryOpen}
            className="flex w-full items-center gap-3 p-4 text-left"
          >
            <Package className="h-5 w-5 shrink-0 text-primary" />
            <span className="flex-1 text-sm font-semibold text-card-foreground">
              {itemCount} {itemCount === 1 ? "artikel" : "artiklar"}
            </span>
            <span className="text-sm font-bold text-card-foreground">{formatPrice(total)}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                summaryOpen && "rotate-180",
              )}
            />
          </button>
          {summaryOpen && (
            <div className="border-t border-border px-4 py-3">
              <div className="space-y-2.5">
                {lines.map((line) => (
                  <div key={line.productId} className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-sm text-card-foreground">
                      <span className="text-muted-foreground">{line.quantity} ×</span> {line.name}
                    </p>
                    <p className="whitespace-nowrap text-sm font-medium text-card-foreground">
                      {formatPrice(line.unitPrice * line.quantity)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Leveransadress */}
        <section id="leveransadress" className="rounded-xl bg-card p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-bold text-card-foreground">Leveransadress</h2>
            {saved?.saved && (
              <span className="text-xs text-muted-foreground">Från ditt kundkort</span>
            )}
          </div>

          <div className="mt-3 space-y-3">
            <FormField
              label="Mottagare"
              value={delivery.recipient}
              onChange={(v) => set("recipient", v)}
              autoComplete="organization"
              autoCapitalize="words"
              placeholder="Företag eller person"
              error={errorFor("recipient")}
            />
            <FormField
              label="Gatuadress"
              value={delivery.street}
              onChange={(v) => set("street", v)}
              autoComplete="address-line1"
              autoCapitalize="words"
              placeholder="Gata och nummer"
              error={errorFor("street")}
            />
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
              <FormField
                label="Postnummer"
                value={delivery.postalCode}
                onChange={(v) => set("postalCode", v)}
                autoComplete="postal-code"
                autoCapitalize="off"
                inputMode="numeric"
                placeholder="123 45"
                error={errorFor("postalCode")}
              />
              <FormField
                label="Ort"
                value={delivery.city}
                onChange={(v) => set("city", v)}
                autoComplete="address-level2"
                autoCapitalize="words"
                error={errorFor("city")}
              />
            </div>
            <FormField
              label="Land"
              value={delivery.country}
              onChange={(v) => set("country", v)}
              autoComplete="country-name"
              autoCapitalize="words"
            />
            <FormField
              label="Mobilnummer"
              value={delivery.phone}
              onChange={(v) => set("phone", v)}
              autoComplete="tel"
              autoCapitalize="off"
              inputMode="tel"
              type="tel"
              placeholder="070-123 45 67"
              hint="Fraktbolaget aviserar leveransen på det här numret."
              error={errorFor("phone")}
            />
            <FormField
              label="Leveransinstruktion"
              value={delivery.note}
              onChange={(v) => set("note", v)}
              placeholder="T.ex. lastkaj på baksidan"
              optional
            />
          </div>

          <button
            type="button"
            onClick={() => setSaveDetails((prev) => !prev)}
            aria-pressed={saveDetails}
            className="mt-4 flex w-full items-center gap-3 rounded-xl bg-muted/60 p-3 text-left"
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                saveDetails
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card",
              )}
            >
              {saveDetails && <Check className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1 text-sm text-card-foreground">
              Spara uppgifterna på mitt kundkort
            </span>
          </button>
        </section>

        {/* Leveranssätt — en tydlig rad, inte ett val, eftersom verkstaden
            bokar frakten efter att ordern kommit in. */}
        <section className="rounded-xl bg-card p-4 shadow-sm">
          <h2 className="text-base font-bold text-card-foreground">Leverans</h2>
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-border p-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-card-foreground">Fraktas av Sipomax</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {total >= freeShippingLimit
                  ? "Fri frakt på den här beställningen."
                  : `Fri frakt över ${formatPrice(freeShippingLimit)}. Fraktkostnaden bekräftas på fakturan.`}
              </p>
            </div>
          </div>
        </section>

        {/* Betalsätt */}
        <section className="rounded-xl bg-card p-4 shadow-sm">
          <h2 className="text-base font-bold text-card-foreground">Betalsätt</h2>
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-primary bg-primary/5 p-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-card-foreground">Faktura</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Beställningen faktureras via Fortnox enligt ert avtal med Sipomax.
              </p>
            </div>
          </div>
        </section>

        <OrderSummary total={total} freeShipping={total >= freeShippingLimit} />
      </div>
    </ShopShell>
  );
}
