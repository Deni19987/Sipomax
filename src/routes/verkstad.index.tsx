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
  MoreHorizontal,
  NotebookPen,
  Package,
  Phone,
  Search,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CATEGORY_ICONS } from "@/components/shop/category-icons";
import { ChatComposer, ChatMessageList, useOrderChat } from "@/components/workshop/chat-thread";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { z } from "zod";
import {
  getWorkshopOrderFn,
  listOrderEventsFn,
  listWorkshopOrdersFn,
  updateOrderInternalNoteFn,
  updateShopOrderStatusFn,
} from "@/lib/shop-orders.functions";
import { formatPrice, getCategory, getProduct } from "@/lib/shop/catalog";
import {
  ORDER_STATUSES,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_DOT,
  ORDER_STATUS_HINTS,
  ORDER_STATUS_LABELS,
  describeOrderEvent,
  nextOrderStatus,
  previousOrderStatus,
  type OrderEvent,
  type ShopOrder,
  type ShopOrderStatus,
} from "@/lib/shop/orders";
import { cn } from "@/lib/utils";

// ?order=<uuid> öppnar orderdetaljerna, utan sökparameter visas översikten.
export const Route = createFileRoute("/verkstad/")({
  ssr: false,
  validateSearch: z.object({ order: z.string().optional(), q: z.string().optional() }),
  component: WorkshopOrdersPage,
});

type StatusFilter = ShopOrderStatus | "alla";

function WorkshopOrdersPage() {
  const { order, q } = Route.useSearch();
  return order ? <OrderDetail orderId={order} /> : <OrderBoard initialSearch={q ?? ""} />;
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

function OrderBoard({ initialSearch }: { initialSearch: string }) {
  const fetchOrders = useServerFn(listWorkshopOrdersFn);
  const { data: orders, isLoading } = useQuery({
    queryKey: ["workshop-orders"],
    queryFn: () => fetchOrders(),
    refetchInterval: 30_000,
  });

  const [filter, setFilter] = useState<StatusFilter>("alla");
  const [search, setSearch] = useState(initialSearch);

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
    <div className="space-y-3 px-4 pt-4 lg:space-y-4 lg:pt-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground lg:text-2xl">Beställningar</h1>
          <p className="text-xs text-muted-foreground lg:text-sm">
            {newCount > 0
              ? `${newCount} ${newCount === 1 ? "ny beställning väntar" : "nya beställningar väntar"}`
              : "Inga nya beställningar just nu"}
            {unreadTotal > 0 ? ` · ${unreadTotal} olästa kommentarer` : ""}
          </p>
        </div>

        <label className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-sm lg:w-96">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök ordernummer, kund eller produkt…"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
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
          <OrderListHeader />
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

// Kolumnmallen delas av rubrikraden och orderraderna på desktop.
const ROW_GRID =
  "lg:grid lg:grid-cols-[2.5rem_9rem_minmax(0,1fr)_6rem_7rem_9rem_5rem_1.25rem] lg:items-center lg:gap-4";

function OrderListHeader() {
  return (
    <div
      className={cn(
        "hidden border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        ROW_GRID,
      )}
    >
      <span />
      <span>Order</span>
      <span>Kund</span>
      <span className="text-right">Artiklar</span>
      <span className="text-right">Summa</span>
      <span>Inkom</span>
      <span className="text-right">Chatt</span>
      <span />
    </div>
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
        ROW_GRID,
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

      <div className="min-w-0 flex-1 lg:flex-none">
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
        {/* Sammanfattning på mobil — på desktop bor uppgifterna i egna kolumner. */}
        <p className="truncate text-xs text-muted-foreground lg:hidden">
          {order.customerName || order.customerEmail || "Okänd kund"} · {itemCount(order)} art. ·{" "}
          {formatPrice(order.total)}
        </p>
        <p className="text-[11px] text-muted-foreground lg:hidden">
          {formatRelative(order.createdAt)}
        </p>
      </div>

      <p className="hidden min-w-0 truncate text-sm text-card-foreground lg:block">
        {order.customerName || order.customerEmail || "Okänd kund"}
      </p>
      <p className="hidden text-right text-sm text-muted-foreground lg:block">
        {itemCount(order)} st
      </p>
      <p className="hidden text-right text-sm font-semibold text-card-foreground lg:block">
        {formatPrice(order.total)}
      </p>
      <p className="hidden text-xs text-muted-foreground lg:block">
        {formatRelative(order.createdAt)}
      </p>

      <div className="flex shrink-0 items-center gap-2 lg:justify-end">
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
        <ChevronRight className="h-4 w-4 text-muted-foreground lg:hidden" />
      </div>

      <ChevronRight className="hidden h-4 w-4 text-muted-foreground lg:block" />
    </Link>
  );
}
// ── Orderdetaljer ───────────────────────────────────────────────────────────

function OrderDetail({ orderId }: { orderId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchOrder = useServerFn(getWorkshopOrderFn);
  const updateStatus = useServerFn(updateShopOrderStatusFn);
  const [tab, setTab] = useState("artiklar");
  const chat = useOrderChat(orderId);

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
      queryClient.invalidateQueries({ queryKey: ["order-events", orderId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Statusen kunde inte uppdateras."),
  });

  if (isLoading) {
    return (
      <div className="px-4 pt-4 lg:pt-8">
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar beställning…</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="space-y-3 px-4 pt-4 lg:pt-8">
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
  const previous = previousOrderStatus(order.status);

  return (
    <div className="space-y-3 px-4 pt-4 lg:space-y-4 lg:pt-8">
      {/* Rubrikrad: tillbaka, ordernummer, status och enda statusåtgärden.
          På mobil hamnar åtgärderna på egen rad under rubriken. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            aria-label="Till alla beställningar"
            onClick={() => navigate({ to: "/verkstad", search: {} })}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card shadow-sm transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-foreground lg:text-2xl">
              Order #{order.orderNumber}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Lagd {formatDateTime(order.createdAt)} · {formatRelative(order.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          <span
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium",
              ORDER_STATUS_BADGE[order.status],
            )}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </span>

          {next ? (
            <button
              type="button"
              onClick={() => statusMutation.mutate(next)}
              disabled={statusMutation.isPending}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50 lg:flex-none"
            >
              {ORDER_STATUS_LABELS[next]}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <span className="flex h-9 flex-1 items-center justify-center rounded-lg bg-emerald-100 px-4 text-sm font-semibold text-emerald-700 lg:flex-none">
              Klar
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Fler åtgärder"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/verkstad/chatt" search={{ trad: order.id }}>
                  Öppna tråden i chatten
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(String(order.orderNumber))
                    .then(() => toast.success("Ordernumret kopierat."))
                    .catch(() => toast.error("Kunde inte kopiera."));
                }}
              >
                Kopiera ordernummer
              </DropdownMenuItem>
              {previous && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate(previous)}
                  >
                    Ångra steget · tillbaka till {ORDER_STATUS_LABELS[previous]}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Vänster: kund + anteckning. Höger: flöde + flikar. */}
      <div className="space-y-3 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-4 lg:space-y-0">
        <div className="space-y-3 lg:space-y-4">
          <CustomerCard order={order} />
          <InternalNote orderId={order.id} note={order.internalNote ?? ""} />
        </div>

        <div className="space-y-3 lg:space-y-4">
          <StatusFlowCard status={order.status} />

          <Tabs value={tab} onValueChange={setTab}>
            <div className="rounded-xl bg-card shadow-sm">
              <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 px-4">
                <OrderTab value="artiklar">Artiklar</OrderTab>
                <OrderTab value="kommentarer">
                  Kommentarer
                  {chat.messages && chat.messages.length > 0 ? ` (${chat.messages.length})` : ""}
                </OrderTab>
                <OrderTab value="historik">Historik</OrderTab>
              </TabsList>

              <TabsContent value="artiklar" className="mt-0 p-4">
                <OrderLines order={order} />
              </TabsContent>
              <TabsContent value="kommentarer" className="mt-0 p-4">
                <ChatMessageList
                  chat={chat}
                  className="max-h-[26rem] overflow-y-auto pr-1"
                  emptyHint="Skriv en kommentar om ordern — hela verkstaden ser den."
                />
              </TabsContent>
              <TabsContent value="historik" className="mt-0 p-4">
                <OrderHistory orderId={order.id} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>

      {/* Komponeraren ligger alltid framme och postar i ordertråden. */}
      <div className="rounded-xl bg-card p-2 shadow-sm">
        <ChatComposer chat={chat} orderId={order.id} onSent={() => setTab("kommentarer")} />
      </div>
    </div>
  );
}

function OrderTab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="rounded-none border-b-2 border-transparent bg-transparent px-3 py-3 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

function CustomerCard({ order }: { order: ShopOrder }) {
  const customerLabel = order.customerName || order.customerEmail || "";
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold text-muted-foreground">Kund</p>
      <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-card-foreground">
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
      {customerLabel && (
        <Link
          to="/verkstad"
          search={{ q: customerLabel }}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-card-foreground transition-colors hover:bg-accent"
        >
          Visa kundens ordrar
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function StatusFlowCard({ status }: { status: ShopOrderStatus }) {
  const currentIndex = ORDER_STATUSES.indexOf(status);
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold text-muted-foreground">Status i flödet</p>
      <div className="mt-4 flex items-start gap-1">
        {ORDER_STATUSES.map((step, index) => {
          const reached = currentIndex >= index;
          return (
            <div key={step} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-center">
                <span
                  className={cn(
                    "h-0.5 flex-1",
                    index === 0 ? "bg-transparent" : reached ? "bg-primary" : "bg-muted",
                  )}
                />
                <span
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full",
                    index === currentIndex
                      ? "bg-primary ring-4 ring-primary/15"
                      : reached
                        ? "bg-primary"
                        : "border-2 border-muted bg-card",
                  )}
                />
                <span
                  className={cn(
                    "h-0.5 flex-1",
                    index === ORDER_STATUSES.length - 1
                      ? "bg-transparent"
                      : currentIndex > index
                        ? "bg-primary"
                        : "bg-muted",
                  )}
                />
              </div>
              <span
                className={cn(
                  "text-center text-[11px]",
                  index === currentIndex
                    ? "font-bold text-foreground"
                    : reached
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {ORDER_STATUS_LABELS[step]}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {ORDER_STATUS_HINTS[status]} · flytta fram ordern med knappen i rubriken.
      </p>
    </div>
  );
}

function OrderLines({ order }: { order: ShopOrder }) {
  return (
    <div>
      <div className="space-y-3">
        {order.lines.map((line) => {
          const product = getProduct(line.productId);
          const category = product ? getCategory(product.category) : undefined;
          const Icon = product ? CATEGORY_ICONS[product.category] : Package;
          return (
            <div key={line.productId} className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                  category?.gradient ?? "from-slate-600 to-slate-800",
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-card-foreground">{line.name}</p>
                <p className="text-xs text-muted-foreground">
                  {line.quantity} × {formatPrice(line.unitPrice)}
                  {line.unit ? ` · ${line.unit}` : ""}
                </p>
              </div>
              <p className="whitespace-nowrap text-sm font-semibold text-card-foreground">
                {formatPrice(line.unitPrice * line.quantity)}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-bold text-card-foreground">Totalt</span>
        <span className="text-sm font-bold text-card-foreground">{formatPrice(order.total)}</span>
      </div>
    </div>
  );
}

const EVENT_ICON: Record<OrderEvent["type"], typeof Package> = {
  created: Package,
  status_changed: ArrowRight,
  note_updated: NotebookPen,
  comment: MessageSquare,
};

function OrderHistory({ orderId }: { orderId: string }) {
  const fetchEvents = useServerFn(listOrderEventsFn);
  const { data: events, isLoading } = useQuery({
    queryKey: ["order-events", orderId],
    queryFn: () => fetchEvents({ data: { orderId } }),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Laddar historik…</p>;
  }

  if (!events || events.length === 0) {
    return (
      <div className="rounded-xl bg-muted/50 p-6 text-center">
        <p className="text-sm font-semibold text-card-foreground">Ingen historik ännu</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Statusändringar, anteckningar och kommentarer loggas här automatiskt.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-4">
      {events.map((event) => {
        const Icon = EVENT_ICON[event.type];
        return (
          <li key={event.id} className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-card-foreground">{describeOrderEvent(event)}</p>
              {event.detail && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">“{event.detail}”</p>
              )}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDateTime(event.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
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
      queryClient.invalidateQueries({ queryKey: ["order-events", orderId] });
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
