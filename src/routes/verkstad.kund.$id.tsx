import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Mail,
  MailCheck,
  MapPin,
  Package,
  Phone,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  getShopCustomerFn,
  resendCustomerInviteFn,
  updateShopCustomerFn,
} from "@/lib/shop-customers.functions";
import { formatPrice } from "@/lib/shop/catalog";
import { customerLabel } from "@/lib/shop/customers";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
  type ShopOrder,
} from "@/lib/shop/orders";
import { cn } from "@/lib/utils";

// ?order=<uuid> betyder att man kom hit från en order — då finns en
// tillbakaknapp som tar en direkt till samma order igen.
const searchSchema = z.object({
  order: z.string().optional(),
});

export const Route = createFileRoute("/verkstad/kund/$id")({
  ssr: false,
  validateSearch: searchSchema,
  component: CustomerCardPage,
});

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function CustomerCardPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const fetchCustomer = useServerFn(getShopCustomerFn);

  const {
    data: customer,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["shop-customer", id],
    queryFn: () => fetchCustomer({ data: { customerId: id } }),
  });

  if (isLoading) {
    return (
      <div className="px-4 pt-4 lg:pt-8">
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar kundkortet…</p>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="px-4 pt-4 lg:pt-8">
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-card-foreground">Kundkortet kunde inte hämtas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "Försök igen om en stund."}
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: "/verkstad/kunder" })}
            className="mt-4 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Till alla kunder
          </button>
        </div>
      </div>
    );
  }

  const name = customerLabel(customer);
  const backOrder = search.order;

  return (
    <div className="space-y-3 px-4 pt-4 lg:space-y-4 lg:pt-8">
      {/* Rubrikrad: vem kunden är och vägen tillbaka dit man kom ifrån */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            aria-label={backOrder ? "Tillbaka till ordern" : "Till alla kunder"}
            onClick={() =>
              backOrder
                ? navigate({ to: "/verkstad", search: { order: backOrder } })
                : navigate({ to: "/verkstad/kunder" })
            }
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card shadow-sm transition-colors active:bg-accent lg:h-9 lg:w-9"
          >
            <ArrowLeft className="h-5 w-5 lg:h-4 lg:w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold text-foreground lg:text-2xl">{name}</h1>
              {customer.pending && (
                <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Inbjuden — inte aktiverad
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {customer.companyName ? `${customer.companyName} · ` : ""}
              Kund sedan {formatDate(customer.createdAt)}
            </p>
          </div>
        </div>

        {backOrder && (
          <Link
            to="/verkstad"
            search={{ order: backOrder }}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-card px-4 text-sm font-semibold text-card-foreground shadow-sm transition-colors hover:bg-accent lg:h-9"
          >
            <ArrowLeft className="h-4 w-4" />
            Tillbaka till ordern
          </Link>
        )}
      </div>

      {/* Snabb överblick */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Beställningar" value={String(customer.orderCount)} />
        <StatCard label="Pågående" value={String(customer.openOrderCount)} />
        <StatCard label="Totalt köpt för" value={formatPrice(customer.totalSpent)} />
        <StatCard
          label="Obetalt"
          value={customer.outstanding > 0 ? formatPrice(customer.outstanding) : "—"}
          tone={customer.outstanding > 0 ? "warn" : "muted"}
        />
      </div>

      <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-4 lg:space-y-0">
        {/* Huvudspalt: historiken, tydligt uppdelad */}
        <div className="space-y-3 lg:space-y-4">
          <OrderSection
            title="Pågående beställningar"
            hint="Allt som fortfarande är på gång — inte levererat, eller levererat men obetalt."
            icon={Clock}
            orders={customer.activeOrders}
            customerId={customer.id}
            emptyText="Inga pågående beställningar just nu."
            tone="active"
          />
          <OrderSection
            title="Färdiga beställningar"
            hint="Levererade och betalda ordrar. De ligger kvar här som historik men syns inte längre i orderlistan."
            icon={CheckCircle2}
            orders={customer.completedOrders}
            customerId={customer.id}
            emptyText="Ingen färdig beställning ännu."
            tone="done"
          />
        </div>

        {/* Sidospalt: kontakt- och leveransuppgifter */}
        <div className="space-y-3 lg:space-y-4">
          <ContactCard customer={customer} />
          <DetailsForm customer={customer} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "muted";
}) {
  return (
    <div className="rounded-xl bg-card p-3 shadow-sm lg:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-bold lg:text-xl",
          tone === "warn"
            ? "text-rose-600"
            : tone === "muted"
              ? "text-muted-foreground"
              : "text-card-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ── Ordrar på kundkortet ────────────────────────────────────────────────────

function OrderSection({
  title,
  hint,
  icon: Icon,
  orders,
  customerId,
  emptyText,
  tone,
}: {
  title: string;
  hint: string;
  icon: typeof Clock;
  orders: ShopOrder[];
  customerId: string;
  emptyText: string;
  tone: "active" | "done";
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm">
      <div
        className={cn(
          "border-b border-border px-4 py-3",
          tone === "done" ? "bg-emerald-50/60" : "bg-muted/40",
        )}
      >
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              tone === "done" ? "text-emerald-600" : "text-primary",
            )}
          />
          <p className="flex-1 text-sm font-bold text-card-foreground">{title}</p>
          <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {orders.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      </div>

      {orders.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        orders.map((order, index) => (
          <CustomerOrderRow
            key={order.id}
            order={order}
            customerId={customerId}
            withBorder={index > 0}
          />
        ))
      )}
    </div>
  );
}

function CustomerOrderRow({
  order,
  customerId,
  withBorder,
}: {
  order: ShopOrder;
  customerId: string;
  withBorder: boolean;
}) {
  const items = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <Link
      to="/verkstad"
      search={{ order: order.id, kund: customerId }}
      className={cn(
        "flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-accent lg:hover:bg-accent",
        withBorder && "border-t border-border",
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Package className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-bold text-card-foreground">#{order.orderNumber}</p>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              ORDER_STATUS_BADGE[order.status],
            )}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </span>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              PAYMENT_STATUS_BADGE[order.paymentStatus],
            )}
          >
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDate(order.createdAt)} · {items} art. · {formatPrice(order.total)}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

// ── Kontaktuppgifter ────────────────────────────────────────────────────────

function ContactCard({
  customer,
}: {
  customer: { id: string; email: string | null; phone: string | null; pending: boolean };
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const resend = useServerFn(resendCustomerInviteFn);

  const mutation = useMutation({
    mutationFn: () =>
      resend({
        data: {
          customerId: customer.id,
          origin: typeof window !== "undefined" ? window.location.origin : null,
        },
      }),
    onSuccess: (result) => {
      toast.success("Inbjudan skickad igen.");
      queryClient.invalidateQueries({ queryKey: ["shop-customers"] });
      queryClient.invalidateQueries({ queryKey: ["shop-customer", customer.id] });
      // Det obesvarade kontot skapades om och har ett nytt id — följ med dit.
      if (result.customer.id !== customer.id) {
        navigate({ to: "/verkstad/kund/$id", params: { id: result.customer.id }, replace: true });
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Inbjudan kunde inte skickas om."),
  });

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-primary" />
        <p className="flex-1 text-sm font-semibold text-card-foreground">Kontakt</p>
      </div>
      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
        {customer.email && (
          <a
            href={`mailto:${customer.email}`}
            className="flex items-center gap-2 hover:text-foreground"
          >
            <Mail className="h-3.5 w-3.5 shrink-0" /> {customer.email}
          </a>
        )}
        {customer.phone && (
          <a
            href={`tel:${customer.phone}`}
            className="flex items-center gap-2 hover:text-foreground"
          >
            <Phone className="h-3.5 w-3.5 shrink-0" /> {customer.phone}
          </a>
        )}
      </div>

      {customer.pending && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            Kunden har inte valt lösenord ännu. Skicka bekräftelsemejlet igen om det kommit bort.
          </p>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-card-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MailCheck className="h-3.5 w-3.5" />
            )}
            Skicka inbjudan igen
          </button>
        </div>
      )}
    </div>
  );
}

// ── Uppgifter som verkstaden kan ändra ──────────────────────────────────────

function DetailsForm({
  customer,
}: {
  customer: {
    id: string;
    displayName: string | null;
    companyName: string | null;
    phone: string | null;
    deliveryRecipient: string | null;
    deliveryStreet: string | null;
    deliveryPostalCode: string | null;
    deliveryCity: string | null;
    deliveryCountry: string | null;
    deliveryNote: string | null;
  };
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateShopCustomerFn);

  const initial = useMemo(
    () => ({
      displayName: customer.displayName ?? "",
      companyName: customer.companyName ?? "",
      phone: customer.phone ?? "",
      deliveryRecipient: customer.deliveryRecipient ?? "",
      deliveryStreet: customer.deliveryStreet ?? "",
      deliveryPostalCode: customer.deliveryPostalCode ?? "",
      deliveryCity: customer.deliveryCity ?? "",
      deliveryCountry: customer.deliveryCountry ?? "",
      deliveryNote: customer.deliveryNote ?? "",
    }),
    [customer],
  );

  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const mutation = useMutation({
    mutationFn: () => save({ data: { customerId: customer.id, patch: form } }),
    onSuccess: () => {
      toast.success("Kundens uppgifter sparade.");
      queryClient.invalidateQueries({ queryKey: ["shop-customer", customer.id] });
      queryClient.invalidateQueries({ queryKey: ["shop-customers"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Uppgifterna kunde inte sparas."),
  });

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 shrink-0 text-primary" />
        <p className="flex-1 text-sm font-semibold text-card-foreground">Uppgifter</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Ändringar här gäller kundens konto och förifyller nästa beställning.
      </p>

      <div className="mt-3 space-y-2">
        <TextField label="Namn" value={form.displayName} onChange={(v) => set("displayName", v)} />
        <TextField
          label="Företag"
          value={form.companyName}
          onChange={(v) => set("companyName", v)}
          icon={Building2}
        />
        <TextField
          label="Telefon"
          value={form.phone}
          onChange={(v) => set("phone", v)}
          icon={Phone}
        />

        <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Leveransuppgifter
        </p>
        <TextField
          label="Mottagare"
          value={form.deliveryRecipient}
          onChange={(v) => set("deliveryRecipient", v)}
        />
        <TextField
          label="Gatuadress"
          value={form.deliveryStreet}
          onChange={(v) => set("deliveryStreet", v)}
        />
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
          <TextField
            label="Postnummer"
            value={form.deliveryPostalCode}
            onChange={(v) => set("deliveryPostalCode", v)}
          />
          <TextField
            label="Ort"
            value={form.deliveryCity}
            onChange={(v) => set("deliveryCity", v)}
          />
        </div>
        <TextField
          label="Land"
          value={form.deliveryCountry}
          onChange={(v) => set("deliveryCountry", v)}
          placeholder="Sverige"
        />
        <div className="space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Leveransinstruktion
          </label>
          <textarea
            value={form.deliveryNote}
            onChange={(e) => set("deliveryNote", e.target.value)}
            rows={2}
            placeholder="T.ex. lämna vid grinden, ring innan leverans…"
            className="w-full resize-none rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setForm(initial)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            Ångra
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            Spara
          </button>
        </div>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: typeof Phone;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
