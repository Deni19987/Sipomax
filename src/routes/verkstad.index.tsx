import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  ChevronRight,
  Mail,
  MessageSquare,
  NotebookPen,
  Package,
  Phone,
  Search,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChatThread } from "@/components/workshop/chat-thread";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { z } from "zod";
import {
  getWorkshopOrderFn,
  listWorkshopOrdersFn,
  updateOrderInternalNoteFn,
  updateShopOrderStatusFn,
} from "@/lib/shop-orders.functions";
import { formatPrice } from "@/lib/shop/catalog";
import {
  ORDER_STATUSES,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_DOT,
  ORDER_STATUS_HINTS,
  ORDER_STATUS_LABELS,
  nextOrderStatus,
  type ShopOrder,
  type ShopOrderStatus,
} from "@/lib/shop/orders";
import { cn } from "@/lib/utils";

// ?order=<uuid> öppnar orderdetaljerna, utan sökparameter visas översikten.
export const Route = createFileRoute("/verkstad/")({
  ssr: false,
  validateSearch: z.object({ order: z.string().optional() }),
  component: WorkshopOrdersPage,
});

type StatusFilter = ShopOrderStatus | "alla";

function WorkshopOrdersPage() {
  const { order } = Route.useSearch();
  return order ? <OrderDetail orderId={order} /> : <OrderBoard />;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso: string) {
  const diffMinutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMinutes < 1) return "nyss";
  if (diffMinutes < 60) return `${diffMinutes} min sedan`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours} tim sedan`;
  const days = Math.round(hours / 24);
  return days === 1 ? "igår" : `${days} dagar sedan`;
}

function itemCount(order: ShopOrder) {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
}

// ── Översikt ────────────────────────────────────────────────────────────────

function OrderBoard() {
  const fetchOrders = useServerFn(listWorkshopOrdersFn);
  const { data: orders, isLoading } = useQuery({
    queryKey: ["workshop-orders"],
    queryFn: () => fetchOrders(),
    refetchInterval: 30_000,
  });

  const [filter, setFilter] = useState<StatusFilter>("alla");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      alla: 0,
      mottagen: 0,
      behandlas: 0,
      skickad: 0,
      levererad: 0,
    };
    for (const order of orders ?? []) {
      base.alla += 1;
      base[order.status] += 1;
    }
    return base;
  }, [orders]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (orders ?? []).filter((order) => {
      if (filter !== "alla" && order.status !== filter) return false;
      if (!term) return true;
      return [
        String(order.orderNumber),
        order.customerName ?? "",
        order.customerEmail ?? "",
        order.customerPhone ?? "",
        ...order.lines.map((l) => l.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [orders, filter, search]);

  const newCount = counts.mottagen;
  const unreadTotal = (orders ?? []).reduce((sum, o) => sum + (o.unreadCount ?? 0), 0);

  return (
    <div className="space-y-3 px-4 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Beställningar</h1>
          <p className="text-xs text-muted-foreground">
            {newCount > 0
              ? `${newCount} ${newCount === 1 ? "ny beställning väntar" : "nya beställningar väntar"}`
              : "Inga nya beställningar just nu"}
            {unreadTotal > 0 ? ` · ${unreadTotal} olästa kommentarer` : ""}
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök ordernummer, kund eller produkt…"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <FilterChip
          label="Alla"
          count={counts.alla}
          active={filter === "alla"}
          onClick={() => setFilter("alla")}
        />
        {ORDER_STATUSES.map((status) => (
          <FilterChip
            key={status}
            label={ORDER_STATUS_LABELS[status]}
            count={counts[status]}
            dot={ORDER_STATUS_DOT[status]}
            active={filter === status}
            onClick={() => setFilter(status)}
          />
        ))}
      </div>

      {filter !== "alla" && (
        <p className="text-xs text-muted-foreground">{ORDER_STATUS_HINTS[filter]}</p>
      )}

      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar beställningar…</p>
        </div>
      ) : visible.length > 0 ? (
        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          {visible.map((order, index) => (
            <OrderRow key={order.id} order={order} withBorder={index > 0} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <Package className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-card-foreground">
            {orders && orders.length > 0 ? "Inga träffar" : "Inga beställningar ännu"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {orders && orders.length > 0
              ? "Prova en annan sökning eller ett annat statusfilter."
              : "När kunder skickar beställningar i butiken dyker de upp här."}
          </p>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  dot,
  active,
  onClick,
}: {
  label: string;
  count: number;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground shadow-sm",
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[11px] font-semibold",
          active ? "bg-primary-foreground/20" : "bg-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function OrderRow({ order, withBorder }: { order: ShopOrder; withBorder: boolean }) {
  const unread = order.unreadCount ?? 0;
  return (
    <Link
      to="/verkstad"
      search={{ order: order.id }}
      className={cn(
        "flex items-center gap-3 p-4 transition-colors hover:bg-accent",
        withBorder && "border-t border-border",
      )}
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Package className="h-5 w-5" />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
            ORDER_STATUS_DOT[order.status],
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-card-foreground">#{order.orderNumber}</p>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              ORDER_STATUS_BADGE[order.status],
            )}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {order.customerName || order.customerEmail || "Okänd kund"} · {itemCount(order)} art. ·{" "}
          {formatPrice(order.total)}
        </p>
        <p className="text-[11px] text-muted-foreground">{formatRelative(order.createdAt)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {unread > 0 && (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              order.mentionsMe
                ? "bg-primary text-primary-foreground"
                : "bg-primary/10 text-primary",
            )}
          >
            {order.mentionsMe ? (
              <AtSign className="h-3 w-3" />
            ) : (
              <MessageSquare className="h-3 w-3" />
            )}
            {unread}
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

// ── Orderdetaljer ───────────────────────────────────────────────────────────

function OrderDetail({ orderId }: { orderId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchOrder = useServerFn(getWorkshopOrderFn);
  const updateStatus = useServerFn(updateShopOrderStatusFn);

  const {
    data: order,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["workshop-order", orderId],
    queryFn: () => fetchOrder({ data: { orderId } }),
    refetchInterval: 30_000,
  });

  const statusMutation = useMutation({
    mutationFn: (status: ShopOrderStatus) => updateStatus({ data: { orderId, status } }),
    onSuccess: (_, status) => {
      toast.success(`Status ändrad till ${ORDER_STATUS_LABELS[status]}`);
      queryClient.invalidateQueries({ queryKey: ["workshop-order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["workshop-orders"] });
      queryClient.invalidateQueries({ queryKey: ["workshop-stats"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Statusen kunde inte uppdateras."),
  });

  if (isLoading) {
    return (
      <div className="px-4 pt-4">
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar beställning…</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="space-y-3 px-4 pt-4">
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-card-foreground">
            Beställningen kunde inte hämtas
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "Försök igen om en stund."}
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: "/verkstad", search: {} })}
            className="mt-4 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Till alla beställningar
          </button>
        </div>
      </div>
    );
  }

  const next = nextOrderStatus(order.status);

  return (
    <div className="space-y-3 px-4 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Till alla beställningar"
          onClick={() => navigate({ to: "/verkstad", search: {} })}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-foreground">Order #{order.orderNumber}</h1>
          <p className="text-xs text-muted-foreground">
            Lagd {formatDateTime(order.createdAt)} · {formatRelative(order.createdAt)}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
            ORDER_STATUS_BADGE[order.status],
          )}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      {/* Statusflöde */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground">Status i flödet</p>
        <div className="mt-3 flex items-center gap-1">
          {ORDER_STATUSES.map((status, index) => {
            const reached = ORDER_STATUSES.indexOf(order.status) >= index;
            return (
              <div key={status} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-center">
                  <span
                    className={cn(
                      "h-1 flex-1 rounded-full",
                      index === 0 ? "bg-transparent" : reached ? "bg-primary" : "bg-muted",
                    )}
                  />
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      reached ? ORDER_STATUS_DOT[status] : "bg-muted",
                    )}
                  />
                  <span
                    className={cn(
                      "h-1 flex-1 rounded-full",
                      index === ORDER_STATUSES.length - 1
                        ? "bg-transparent"
                        : ORDER_STATUSES.indexOf(order.status) > index
                          ? "bg-primary"
                          : "bg-muted",
                    )}
                  />
                </div>
                <span
                  className={cn(
                    "text-center text-[10px]",
                    reached ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {ORDER_STATUS_LABELS[status]}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Select
            value={order.status}
            onValueChange={(status) => statusMutation.mutate(status as ShopOrderStatus)}
            disabled={statusMutation.isPending}
          >
            <SelectTrigger className="h-9 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_STATUSES.map((status) => (
                <SelectItem key={status} value={status} className="text-xs">
                  {ORDER_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {next && (
            <button
              type="button"
              onClick={() => statusMutation.mutate(next)}
              disabled={statusMutation.isPending}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {ORDER_STATUS_LABELS[next]}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Kund */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
          <UserRound className="h-4 w-4 shrink-0 text-primary" />
          {order.customerName || "Okänd kund"}
        </p>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {order.customerEmail && (
            <a
              href={`mailto:${order.customerEmail}`}
              className="flex items-center gap-2 hover:text-foreground"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" /> {order.customerEmail}
            </a>
          )}
          {order.customerPhone && (
            <a
              href={`tel:${order.customerPhone}`}
              className="flex items-center gap-2 hover:text-foreground"
            >
              <Phone className="h-3.5 w-3.5 shrink-0" /> {order.customerPhone}
            </a>
          )}
          {!order.customerEmail && !order.customerPhone && (
            <p>Inga kontaktuppgifter sparade på kunden.</p>
          )}
        </div>
      </div>

      {/* Rader */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground">
          Innehåll · {itemCount(order)} artiklar
        </p>
        <div className="mt-3 space-y-2">
          {order.lines.map((line) => (
            <div key={line.productId} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-card-foreground">{line.name}</p>
                <p className="text-xs text-muted-foreground">
                  {line.quantity} × {formatPrice(line.unitPrice)}
                  {line.unit ? ` · ${line.unit}` : ""}
                </p>
              </div>
              <p className="whitespace-nowrap text-sm font-semibold text-card-foreground">
                {formatPrice(line.unitPrice * line.quantity)}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm font-bold text-card-foreground">Totalt</span>
          <span className="text-sm font-bold text-card-foreground">{formatPrice(order.total)}</span>
        </div>
      </div>

      <InternalNote orderId={order.id} note={order.internalNote ?? ""} />

      {/* Ordertråd */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm font-semibold text-card-foreground">Kommentarer om ordern</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Alla i verkstaden ser tråden. Tagga en kollega med @ så får hen en notis.
        </p>
        <div className="mt-3">
          <ChatThread
            orderId={order.id}
            variant="panel"
            emptyHint="Skriv en kommentar om ordern — hela verkstaden ser den."
          />
        </div>
      </div>
    </div>
  );
}

function InternalNote({ orderId, note }: { orderId: string; note: string }) {
  const queryClient = useQueryClient();
  const saveNote = useServerFn(updateOrderInternalNoteFn);
  const [draft, setDraft] = useState(note);

  // Håll fältet i synk när ordern laddas om (eller en kollega hinner före).
  useEffect(() => {
    setDraft(note);
  }, [note, orderId]);

  const mutation = useMutation({
    mutationFn: (value: string) => saveNote({ data: { orderId, note: value } }),
    onSuccess: () => {
      toast.success("Anteckningen sparad.");
      queryClient.invalidateQueries({ queryKey: ["workshop-order", orderId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Anteckningen kunde inte sparas."),
  });

  const dirty = draft !== note;

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <NotebookPen className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm font-semibold text-card-foreground">Intern anteckning</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Syns bara för verkstaden, aldrig för kunden.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="T.ex. saknas i lager, ring kunden innan leverans…"
        className="mt-3 w-full resize-none rounded-lg bg-muted/50 p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDraft(note)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            Ångra
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate(draft)}
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
