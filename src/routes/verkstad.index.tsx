import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  AtSign,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Package,
  Phone,
  Receipt,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CATEGORY_ICONS } from "@/components/shop/category-icons";
import { ChatComposer, ChatMessageList, useOrderChat } from "@/components/workshop/chat-thread";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  updateOrderPaymentStatusFn,
  updateOrderShippingFn,
  updateShopOrderStatusFn,
} from "@/lib/shop-orders.functions";
import { formatPrice, getCategory, getProduct } from "@/lib/shop/catalog";
import {
  DEFAULT_FILTERS,
  ORDER_AMOUNTS,
  ORDER_AMOUNT_LABELS,
  ORDER_PAYMENTS,
  ORDER_PAYMENT_LABELS,
  ORDER_PERIODS,
  ORDER_PERIOD_LABELS,
  ORDER_SORTS,
  ORDER_SORT_LABELS,
  ORDER_VIEWS,
  ORDER_VIEW_HINTS,
  ORDER_VIEW_LABELS,
  activeFilterChips,
  clearFilterKey,
  clearRefinements,
  countByPayment,
  countByView,
  dayGroupLabel,
  filterOrders,
  groupsByDay,
  type OrderAmount,
  type OrderFilters,
  type OrderPayment,
  type OrderPeriod,
  type OrderSort,
  type OrderView,
} from "@/lib/shop/order-filters";
import {
  CARRIERS,
  ORDER_STATUSES,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_DOT,
  ORDER_STATUS_HINTS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
  describeOrderEvent,
  formatAddressLines,
  getCarrier,
  invoiceStateLabel,
  nextOrderStatus,
  previousOrderStatus,
  trackingLink,
  type OrderEvent,
  type PaymentStatus,
  type ShopOrder,
  type ShopOrderStatus,
} from "@/lib/shop/orders";
import {
  createOrderInvoiceFn,
  getWorkshopOrderInvoicePdfFn,
  refreshOrderInvoiceFn,
  syncShopOrderPaymentsFn,
} from "@/lib/shop-fortnox.functions";
import { openOrDownloadPdf } from "@/lib/pdf-download";
import { cn } from "@/lib/utils";

// ?order=<uuid> öppnar orderdetaljerna, utan den visas översikten. Övriga
// parametrar är listans filter — de ligger i URL:en så att en vy går att dela,
// bokmärka och backa tillbaka till.
const searchSchema = z.object({
  order: z.string().optional(),
  vy: z.enum(ORDER_VIEWS as [OrderView, ...OrderView[]]).optional(),
  q: z.string().optional(),
  period: z.enum(ORDER_PERIODS as [OrderPeriod, ...OrderPeriod[]]).optional(),
  belopp: z.enum(ORDER_AMOUNTS as [OrderAmount, ...OrderAmount[]]).optional(),
  betalning: z.enum(ORDER_PAYMENTS as [OrderPayment, ...OrderPayment[]]).optional(),
  olasta: z.boolean().optional(),
  taggad: z.boolean().optional(),
  kommenterad: z.boolean().optional(),
  anteckning: z.boolean().optional(),
  sortering: z.enum(ORDER_SORTS as [OrderSort, ...OrderSort[]]).optional(),
});

type OrderSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/verkstad/")({
  ssr: false,
  validateSearch: searchSchema,
  component: WorkshopOrdersPage,
});

function searchToFilters(search: OrderSearch): OrderFilters {
  return {
    view: search.vy ?? DEFAULT_FILTERS.view,
    query: search.q ?? DEFAULT_FILTERS.query,
    period: search.period ?? DEFAULT_FILTERS.period,
    amount: search.belopp ?? DEFAULT_FILTERS.amount,
    payment: search.betalning ?? DEFAULT_FILTERS.payment,
    unread: search.olasta ?? DEFAULT_FILTERS.unread,
    mentioned: search.taggad ?? DEFAULT_FILTERS.mentioned,
    commented: search.kommenterad ?? DEFAULT_FILTERS.commented,
    noted: search.anteckning ?? DEFAULT_FILTERS.noted,
    sort: search.sortering ?? DEFAULT_FILTERS.sort,
  };
}

// Bara det som avviker från standard hamnar i URL:en — annars växer adressen
// med brus som gör delade länkar svårlästa.
function filtersToSearch(filters: OrderFilters): OrderSearch {
  return {
    vy: filters.view === DEFAULT_FILTERS.view ? undefined : filters.view,
    q: filters.query.trim() || undefined,
    period: filters.period === DEFAULT_FILTERS.period ? undefined : filters.period,
    belopp: filters.amount === DEFAULT_FILTERS.amount ? undefined : filters.amount,
    betalning: filters.payment === DEFAULT_FILTERS.payment ? undefined : filters.payment,
    olasta: filters.unread || undefined,
    taggad: filters.mentioned || undefined,
    kommenterad: filters.commented || undefined,
    anteckning: filters.noted || undefined,
    sortering: filters.sort === DEFAULT_FILTERS.sort ? undefined : filters.sort,
  };
}

function WorkshopOrdersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const filters = searchToFilters(search);

  // Filterändringar ersätter historikposten så att bakåtknappen tar dig ut ur
  // listan i stället för att stega igenom varje justering.
  function setFilters(next: Partial<OrderFilters>) {
    navigate({
      to: "/verkstad",
      search: filtersToSearch({ ...filters, ...next }),
      replace: true,
    });
  }

  if (search.order) {
    return <OrderDetail orderId={search.order} backSearch={filtersToSearch(filters)} />;
  }
  return <OrderBoard filters={filters} setFilters={setFilters} />;
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

function OrderBoard({
  filters,
  setFilters,
}: {
  filters: OrderFilters;
  setFilters: (next: Partial<OrderFilters>) => void;
}) {
  const queryClient = useQueryClient();
  const fetchOrders = useServerFn(listWorkshopOrdersFn);
  const syncPayments = useServerFn(syncShopOrderPaymentsFn);
  const { data: orders, isLoading } = useQuery({
    queryKey: ["workshop-orders"],
    queryFn: () => fetchOrders(),
    refetchInterval: 30_000,
  });

  // Betalningar registreras i Fortnox, inte här. Medan någon har listan uppe
  // stäms de obetalda fakturorna av med jämna mellanrum, så att en betald
  // faktura flyttar sin order till Avklarad utan att någon behöver göra något.
  // Intervallet är glest — Fortnox API:t ska inte pollas i onödan.
  const { data: paymentSync } = useQuery({
    queryKey: ["shop-invoice-sync"],
    queryFn: () => syncPayments(),
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useEffect(() => {
    if (paymentSync?.completed) {
      queryClient.invalidateQueries({ queryKey: ["workshop-orders"] });
      queryClient.invalidateQueries({ queryKey: ["workshop-stats"] });
    }
  }, [paymentSync, queryClient]);

  // Sökrutan skrivs lokalt och speglas till URL:en — annars skulle varje
  // tangenttryck bli en egen post i webbläsarhistoriken.
  const [queryDraft, setQueryDraft] = useState(filters.query);
  useEffect(() => setQueryDraft(filters.query), [filters.query]);
  useEffect(() => {
    if (queryDraft === filters.query) return;
    const timer = setTimeout(() => setFilters({ query: queryDraft }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft]);

  const all = useMemo(() => orders ?? [], [orders]);
  const counts = useMemo(() => countByView(all, filters), [all, filters]);
  // Underlag till menyn som fälls ut när man klickar på en statusflik: hur
  // många av vyns ordrar som ligger i varje betalläge.
  const paymentCounts = useMemo(
    () =>
      Object.fromEntries(
        ORDER_VIEWS.map((view) => [view, countByPayment(all, filters, view)]),
      ) as Record<OrderView, Record<OrderPayment, number>>,
    [all, filters],
  );
  const visible = useMemo(() => filterOrders(all, filters), [all, filters]);
  const chips = activeFilterChips(filters);

  const unreadTotal = all.reduce((sum, o) => sum + (o.unreadCount ?? 0), 0);
  const mentionTotal = all.filter((o) => o.mentionsMe).length;

  return (
    <div className="space-y-3 px-4 pt-3 lg:space-y-4 lg:pt-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground lg:text-2xl">Beställningar</h1>
          <p className="text-xs text-muted-foreground lg:text-sm">
            {counts["att-gora"] > 0 ? `${counts["att-gora"]} att göra` : "Inget att göra just nu"}
            {unreadTotal > 0 ? ` · ${unreadTotal} olästa kommentarer` : ""}
          </p>
        </div>

        <label className="flex h-12 items-center gap-2.5 rounded-xl bg-card px-3.5 shadow-sm lg:h-10 lg:w-96">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            placeholder="Sök order, kund eller produkt…"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground lg:text-sm"
          />
          {queryDraft && (
            <button
              type="button"
              aria-label="Rensa sökningen"
              onClick={() => setQueryDraft("")}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      {/* Vyflikar — den vanligaste frågan (var i flödet?) alltid ett klick bort */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
        {ORDER_VIEWS.map((view) => (
          <ViewTab
            key={view}
            label={ORDER_VIEW_LABELS[view]}
            hint={ORDER_VIEW_HINTS[view]}
            count={counts[view]}
            dot={view in ORDER_STATUS_DOT ? ORDER_STATUS_DOT[view as ShopOrderStatus] : undefined}
            active={filters.view === view}
            payment={filters.payment}
            paymentCounts={paymentCounts[view]}
            onSelect={(payment) => setFilters({ view, payment })}
          />
        ))}
      </div>

      {/* Förfiningar: en enda vågrätt remsa på mobil — samma mönster som
          filterchipsen i en vanlig produktlista. På desktop får de radbrytas
          och sorteringen lägga sig till höger. */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
        <ToggleFilter
          icon={MessageSquare}
          label="Olästa"
          count={unreadTotal > 0 ? all.filter((o) => (o.unreadCount ?? 0) > 0).length : 0}
          active={filters.unread}
          onClick={() => setFilters({ unread: !filters.unread })}
        />
        <ToggleFilter
          icon={AtSign}
          label="Jag är taggad"
          count={mentionTotal}
          active={filters.mentioned}
          onClick={() => setFilters({ mentioned: !filters.mentioned })}
        />

        <MenuButton
          icon={CalendarDays}
          label={filters.period === "alla" ? "Period" : ORDER_PERIOD_LABELS[filters.period]}
          active={filters.period !== "alla"}
        >
          <DropdownMenuRadioGroup
            value={filters.period}
            onValueChange={(value) => setFilters({ period: value as OrderPeriod })}
          >
            {ORDER_PERIODS.map((period) => (
              <DropdownMenuRadioItem key={period} value={period}>
                {ORDER_PERIOD_LABELS[period]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </MenuButton>

        <MenuButton
          icon={SlidersHorizontal}
          label="Filter"
          active={filters.amount !== "alla" || filters.commented || filters.noted}
        >
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Ordervärde
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.amount}
            onValueChange={(value) => setFilters({ amount: value as OrderAmount })}
          >
            {ORDER_AMOUNTS.map((amount) => (
              <DropdownMenuRadioItem key={amount} value={amount}>
                {ORDER_AMOUNT_LABELS[amount]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Innehåll
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={filters.commented}
            onCheckedChange={(checked) => setFilters({ commented: !!checked })}
          >
            Har kommentarer
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={filters.noted}
            onCheckedChange={(checked) => setFilters({ noted: !!checked })}
          >
            Har intern anteckning
          </DropdownMenuCheckboxItem>
        </MenuButton>

        <div className="lg:ml-auto">
          <MenuButton icon={ArrowUpDown} label={ORDER_SORT_LABELS[filters.sort]} align="end">
            <DropdownMenuRadioGroup
              value={filters.sort}
              onValueChange={(value) => setFilters({ sort: value as OrderSort })}
            >
              {ORDER_SORTS.map((sort) => (
                <DropdownMenuRadioItem key={sort} value={sort}>
                  {ORDER_SORT_LABELS[sort]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </MenuButton>
        </div>
      </div>

      {/* Allt aktivt syns som chips — inget filter kan gömma sig i en meny */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilters(clearFilterKey(filters, chip.key))}
              className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFilters(clearRefinements(filters))}
            className="rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            Rensa alla
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar beställningar…</p>
        </div>
      ) : visible.length > 0 ? (
        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          <OrderListHeader />
          <OrderRows orders={visible} sort={filters.sort} />
          <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            Visar {visible.length} av {all.length} beställningar
            {filters.view !== "alla" ? ` · ${ORDER_VIEW_HINTS[filters.view]}` : ""}
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <Package className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-card-foreground">
            {all.length > 0 ? "Inga träffar" : "Inga beställningar ännu"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {all.length > 0
              ? "Ingen beställning matchar filtren just nu."
              : "När kunder skickar beställningar i butiken dyker de upp här."}
          </p>
          {all.length > 0 && (
            <button
              type="button"
              onClick={() => setFilters({ ...clearRefinements(filters), view: "alla" })}
              className="mt-4 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              Rensa alla filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Vyflik med antal, t.ex. "Levererad 5".
 *
 * Ett klick fäller ut fliken till en liten meny med vyns betallägen. Det är
 * där den andra halvan av frågan bor: en levererad order kan vara obetald,
 * fakturerad, betald eller på väg tillbaka som retur, och menyn låter en
 * filtrera på precis det utan att lämna fliken.
 */
function ViewTab({
  label,
  hint,
  count,
  dot,
  active,
  payment,
  paymentCounts,
  onSelect,
}: {
  label: string;
  hint: string;
  count: number;
  dot?: string;
  active: boolean;
  payment: OrderPayment;
  paymentCounts: Record<OrderPayment, number>;
  onSelect: (payment: OrderPayment) => void;
}) {
  const activePayment = active ? payment : "alla";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors lg:h-8 lg:text-xs",
          active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground shadow-sm",
        )}
      >
        {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
        {label}
        {active && payment !== "alla" && (
          <span className="text-[11px] font-semibold opacity-80">
            · {ORDER_PAYMENT_LABELS[payment]}
          </span>
        )}
        <span
          className={cn(
            "rounded-full px-1.5 text-[11px] font-semibold",
            active ? "bg-primary-foreground/20" : "bg-muted",
          )}
        >
          {count}
        </span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {hint}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={activePayment}
          onValueChange={(value) => onSelect(value as OrderPayment)}
        >
          {ORDER_PAYMENTS.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              disabled={paymentCounts[option] === 0 && option !== activePayment}
            >
              <span className="flex-1">
                {option === "alla" ? `Alla · ${label.toLowerCase()}` : ORDER_PAYMENT_LABELS[option]}
              </span>
              <span className="ml-2 text-[11px] font-semibold text-muted-foreground">
                {paymentCounts[option]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** På/av-knapp för de mest använda förfiningarna. */
function ToggleFilter({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0 && !active}
      className={cn(
        "flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors lg:h-8 lg:text-xs",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-50 disabled:hover:text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[11px] font-semibold",
            active ? "bg-primary-foreground/20" : "bg-primary/10 text-primary",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Knapp som fäller ut en meny med filteralternativ. */
function MenuButton({
  icon: Icon,
  label,
  active,
  align = "start",
  children,
}: {
  icon: typeof MessageSquare;
  label: string;
  active?: boolean;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors lg:h-8 lg:text-xs",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground shadow-sm hover:text-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Raderna, med dagsrubriker när listan är sorterad på datum. */
function OrderRows({ orders, sort }: { orders: ShopOrder[]; sort: OrderSort }) {
  const grouped = groupsByDay(sort);
  let lastGroup: string | null = null;

  return (
    <>
      {orders.map((order, index) => {
        const group = grouped ? dayGroupLabel(order.createdAt) : null;
        const showGroup = group !== null && group !== lastGroup;
        if (group) lastGroup = group;
        return (
          <div key={order.id}>
            {showGroup && (
              <p className="border-t border-border bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
            )}
            <OrderRow order={order} withBorder={index > 0 && !showGroup} />
          </div>
        );
      })}
    </>
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
      search={(prev) => ({ ...prev, order: order.id })}
      className={cn(
        "flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-accent lg:hover:bg-accent",
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
        <p className="truncate text-sm text-card-foreground lg:hidden">
          {order.customerName || order.customerEmail || "Okänd kund"}
        </p>
        <p className="text-xs text-muted-foreground lg:hidden">
          {itemCount(order)} art. · {formatPrice(order.total)} · {formatRelative(order.createdAt)}
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
//
// Layouten följer samma logik som andra ordersystem: huvudspalten bär ordern
// och åtgärderna (var i flödet, vad som beställts, betalning), sidospalten bär
// referensuppgifterna man tittar på medan man jobbar (kund, vart det ska,
// interna anteckningar). På mobil staplas allt i samma ordning.

function OrderDetail({
  orderId,
  backSearch,
}: {
  orderId: string;
  /** Listans filter, så att tillbakaknappen återvänder till samma vy. */
  backSearch: Record<string, unknown>;
}) {
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
    onSuccess: (result, status) => {
      if (result.invoiceError) {
        toast.warning(`Levererad — men fakturan misslyckades: ${result.invoiceError}`);
      } else if (result.invoiceId) {
        toast.success(`Levererad · faktura #${result.invoiceId} skapad i Fortnox`);
      } else {
        toast.success(`Status ändrad till ${ORDER_STATUS_LABELS[status]}`);
      }
      invalidateOrder(queryClient, orderId);
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
            onClick={() => navigate({ to: "/verkstad", search: backSearch })}
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
      {/* Rubrikrad: identitet, båda statusarna och enda statusåtgärden */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            aria-label="Till alla beställningar"
            onClick={() => navigate({ to: "/verkstad", search: backSearch })}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card shadow-sm transition-colors active:bg-accent lg:h-9 lg:w-9"
          >
            <ArrowLeft className="h-5 w-5 lg:h-4 lg:w-4" />
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
          <span
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium",
              PAYMENT_STATUS_BADGE[order.paymentStatus],
            )}
          >
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </span>

          {next ? (
            <button
              type="button"
              onClick={() => statusMutation.mutate(next)}
              disabled={statusMutation.isPending}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-50 lg:h-9 lg:rounded-lg lg:text-sm lg:flex-none"
            >
              {ORDER_STATUS_LABELS[next]}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <span className="flex h-12 flex-1 items-center justify-center rounded-xl bg-emerald-100 px-4 text-base font-semibold text-emerald-700 lg:h-9 lg:rounded-lg lg:text-sm lg:flex-none">
              Klar
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Fler åtgärder"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent lg:h-9 lg:w-9 lg:rounded-lg"
            >
              <MoreHorizontal className="h-5 w-5 lg:h-4 lg:w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/verkstad/chatt" search={{ trad: order.id }}>
                  Öppna tråden i chatten
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => copyToClipboard(String(order.orderNumber), "Ordernumret kopierat.")}
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

      <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-4 lg:space-y-0">
        {/* Huvudspalt: ordern och åtgärderna */}
        <div className="space-y-3 lg:space-y-4">
          <StatusFlowCard status={order.status} />

          <Tabs value={tab} onValueChange={setTab}>
            <div className="rounded-xl bg-card shadow-sm">
              <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 px-4">
                <OrderTab value="artiklar">Artiklar ({order.lines.length})</OrderTab>
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

          <InvoiceCard order={order} />
          <PaymentCard order={order} />
        </div>

        {/* Sidospalt: vem, vart och interna noteringar */}
        <div className="space-y-3 lg:space-y-4">
          <CustomerCard order={order} />
          <ShippingCard order={order} />
          <InternalNote orderId={order.id} note={order.internalNote ?? ""} />
        </div>
      </div>

      {/* Komponeraren ligger alltid framme och postar i ordertråden. */}
      <div className="rounded-xl bg-card p-2 shadow-sm">
        <ChatComposer chat={chat} orderId={order.id} onSent={() => setTab("kommentarer")} />
      </div>
    </div>
  );
}

function invalidateOrder(queryClient: ReturnType<typeof useQueryClient>, orderId: string) {
  queryClient.invalidateQueries({ queryKey: ["workshop-order", orderId] });
  queryClient.invalidateQueries({ queryKey: ["workshop-orders"] });
  queryClient.invalidateQueries({ queryKey: ["workshop-stats"] });
  queryClient.invalidateQueries({ queryKey: ["order-events", orderId] });
}

function copyToClipboard(text: string, message: string) {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(message))
    .catch(() => toast.error("Kunde inte kopiera."));
}

function OrderTab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="min-h-12 rounded-none border-b-2 border-transparent bg-transparent px-3 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

/** Rubrik som används av alla kort i ordervyn. */
function CardTitle({
  icon: Icon,
  children,
  action,
}: {
  icon: typeof Package;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1 text-sm font-semibold text-card-foreground">{children}</p>
      {action}
    </div>
  );
}

// ── Kund ────────────────────────────────────────────────────────────────────

function CustomerCard({ order }: { order: ShopOrder }) {
  const customerLabel = order.customerName || order.customerEmail || "";
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <CardTitle icon={UserRound}>Kund</CardTitle>
      <p className="mt-3 text-sm font-semibold text-card-foreground">
        {order.customerName || "Okänd kund"}
      </p>
      <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
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
          search={{ q: customerLabel, vy: "alla" }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-card-foreground transition-colors hover:bg-accent"
        >
          Visa kundens ordrar
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

// ── Faktura (Fortnox) ───────────────────────────────────────────────────────
//
// Fakturan skapas automatiskt när ordern markeras som levererad. Kortet visar
// vad som hänt: fakturan och dess PDF, en avstämning mot Fortnox betalstatus,
// och — om något gick fel — felet plus möjligheten att köra om.

function InvoiceCard({ order }: { order: ShopOrder }) {
  const queryClient = useQueryClient();
  const fetchPdf = useServerFn(getWorkshopOrderInvoicePdfFn);
  const refreshInvoice = useServerFn(refreshOrderInvoiceFn);
  const createInvoice = useServerFn(createOrderInvoiceFn);
  const invoice = order.invoice;

  const downloadMutation = useMutation({
    mutationFn: () => fetchPdf({ data: { orderId: order.id } }),
    onSuccess: (result) =>
      openOrDownloadPdf(result.pdfBase64, `Faktura-${result.invoiceId}.pdf`).catch(() =>
        toast.error("Fakturan kunde inte öppnas."),
      ),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Fakturan kunde inte hämtas."),
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshInvoice({ data: { orderId: order.id } }),
    onSuccess: (result) => {
      toast.success(
        result.paid ? "Fakturan är betald — ordern är avklarad." : "Fakturan är ännu inte betald.",
      );
      invalidateOrder(queryClient, order.id);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Fortnox kunde inte kontaktas."),
  });

  const createMutation = useMutation({
    mutationFn: () => createInvoice({ data: { orderId: order.id } }),
    onSuccess: (result) => {
      toast.success(`Faktura #${result.invoiceId} skapades i Fortnox.`);
      invalidateOrder(queryClient, order.id);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Fakturan kunde inte skapas."),
  });

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <CardTitle icon={Receipt}>Faktura</CardTitle>

      {invoice ? (
        <>
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Fakturanummer</span>
              <span className="font-semibold text-card-foreground">#{invoice.invoiceId}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status i Fortnox</span>
              <span className="font-semibold text-card-foreground">
                {invoiceStateLabel(invoice)}
              </span>
            </div>
            {invoice.total != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Belopp (inkl. moms)</span>
                <span className="font-semibold text-card-foreground">
                  {formatPrice(invoice.total)}
                </span>
              </div>
            )}
            {invoice.dueDate && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Förfaller</span>
                <span className="text-card-foreground">{invoice.dueDate}</span>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={downloadMutation.isPending}
              onClick={() => downloadMutation.mutate()}
              className="flex h-11 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50 lg:h-8 lg:text-xs"
            >
              <Download className="h-4 w-4" />
              {downloadMutation.isPending ? "Hämtar…" : "Ladda ner faktura"}
            </button>
            {!invoice.paidAt && (
              <button
                type="button"
                disabled={refreshMutation.isPending}
                onClick={() => refreshMutation.mutate()}
                className="flex h-11 items-center gap-1.5 rounded-lg bg-muted px-3.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 lg:h-8 lg:text-xs"
              >
                <RefreshCw className={cn("h-4 w-4", refreshMutation.isPending && "animate-spin")} />
                Uppdatera från Fortnox
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            {order.invoiceError
              ? `Fakturan kunde inte skapas: ${order.invoiceError}`
              : order.status === "levererad" || order.status === "avklarad"
                ? "Ingen faktura är kopplad till ordern ännu."
                : "Fakturan skapas automatiskt i Fortnox när ordern markeras som levererad."}
          </p>
          {(order.invoiceError || order.status === "levererad" || order.status === "avklarad") && (
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="flex h-11 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50 lg:h-8 lg:text-xs"
            >
              <Receipt className="h-4 w-4" />
              {createMutation.isPending ? "Skapar…" : "Skapa faktura i Fortnox"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Betalning ───────────────────────────────────────────────────────────────

function PaymentCard({ order }: { order: ShopOrder }) {
  const queryClient = useQueryClient();
  const updatePayment = useServerFn(updateOrderPaymentStatusFn);

  const mutation = useMutation({
    mutationFn: (paymentStatus: PaymentStatus) =>
      updatePayment({ data: { orderId: order.id, paymentStatus } }),
    onSuccess: (_, paymentStatus) => {
      toast.success(`Betalstatus: ${PAYMENT_STATUS_LABELS[paymentStatus]}`);
      invalidateOrder(queryClient, order.id);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Betalstatus kunde inte ändras."),
  });

  const itemTotal = order.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <CardTitle icon={CreditCard}>Betalning</CardTitle>

      <div className="mt-3 flex flex-wrap gap-2">
        {PAYMENT_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(status)}
            className={cn(
              "h-11 rounded-lg px-3.5 text-sm font-semibold transition-colors disabled:opacity-50 lg:h-8 lg:text-xs",
              order.paymentStatus === status
                ? PAYMENT_STATUS_BADGE[status]
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {PAYMENT_STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Delsumma ({order.lines.reduce((sum, l) => sum + l.quantity, 0)} artiklar)</span>
          <span>{formatPrice(itemTotal)}</span>
        </div>
        <div className="flex items-center justify-between font-bold text-card-foreground">
          <span>Totalt</span>
          <span>{formatPrice(order.total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Leverans: adress, fraktbolag och kollinummer ────────────────────────────

function ShippingCard({ order }: { order: ShopOrder }) {
  const queryClient = useQueryClient();
  const saveShipping = useServerFn(updateOrderShippingFn);

  const initial = useMemo(
    () => ({
      recipient: order.shipping.recipient ?? "",
      street: order.shipping.street ?? "",
      postalCode: order.shipping.postalCode ?? "",
      city: order.shipping.city ?? "",
      country: order.shipping.country ?? "",
      carrier: order.carrier ?? "",
      trackingNumber: order.trackingNumber ?? "",
    }),
    [order],
  );

  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState(false);
  useEffect(() => setForm(initial), [initial]);

  const mutation = useMutation({
    mutationFn: () =>
      saveShipping({
        data: {
          orderId: order.id,
          recipient: form.recipient || null,
          street: form.street || null,
          postalCode: form.postalCode || null,
          city: form.city || null,
          country: form.country || null,
          carrier: form.carrier || null,
          trackingNumber: form.trackingNumber || null,
        },
      }),
    onSuccess: () => {
      toast.success("Leveransuppgifterna sparade.");
      setEditing(false);
      invalidateOrder(queryClient, order.id);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Uppgifterna kunde inte sparas."),
  });

  const addressLines = formatAddressLines(order.shipping);
  const carrier = getCarrier(order.carrier);
  const tracking = trackingLink(order.carrier, order.trackingNumber);

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <CardTitle
        icon={Truck}
        action={
          !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ändra
            </button>
          ) : undefined
        }
      >
        Leverans
      </CardTitle>

      {!editing ? (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Leveransadress
            </p>
            {addressLines.length > 0 ? (
              <div className="mt-1 flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-sm text-card-foreground">
                  {addressLines.map((line) => (
                    <p key={line} className="truncate">
                      {line}
                    </p>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="Kopiera adressen"
                  onClick={() => copyToClipboard(addressLines.join("\n"), "Adressen kopierad.")}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Ingen adress angiven ännu.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Fraktbolag
              </p>
              <p className="mt-0.5 truncate text-sm text-card-foreground">{carrier?.name ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Kollinummer
              </p>
              {order.trackingNumber ? (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <p className="truncate text-sm text-card-foreground">{order.trackingNumber}</p>
                  <button
                    type="button"
                    aria-label="Kopiera kollinumret"
                    onClick={() =>
                      copyToClipboard(order.trackingNumber ?? "", "Kollinumret kopierat.")
                    }
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 text-sm text-muted-foreground">—</p>
              )}
            </div>
          </div>

          {order.deliveryNote && (
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Kundens instruktion
              </p>
              <p className="mt-0.5 text-sm text-card-foreground">”{order.deliveryNote}”</p>
            </div>
          )}

          {tracking && (
            <a
              href={tracking}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-card-foreground transition-colors hover:bg-accent"
            >
              Spåra sändningen
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <ShippingField
            label="Mottagare"
            value={form.recipient}
            onChange={(v) => set("recipient", v)}
            placeholder={order.customerName ?? "Företag eller person"}
          />
          <ShippingField
            label="Gatuadress"
            value={form.street}
            onChange={(v) => set("street", v)}
            placeholder="Gata och nummer"
          />
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
            <ShippingField
              label="Postnummer"
              value={form.postalCode}
              onChange={(v) => set("postalCode", v)}
              placeholder="123 45"
            />
            <ShippingField
              label="Ort"
              value={form.city}
              onChange={(v) => set("city", v)}
              placeholder="Ort"
            />
          </div>
          <ShippingField
            label="Land"
            value={form.country}
            onChange={(v) => set("country", v)}
            placeholder="Sverige"
          />

          <div className="space-y-1 pt-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Fraktbolag
            </label>
            <select
              value={form.carrier}
              onChange={(e) => set("carrier", e.target.value)}
              className="w-full rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">Inte valt</option>
              {CARRIERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <ShippingField
            label="Kollinummer"
            value={form.trackingNumber}
            onChange={(v) => set("trackingNumber", v)}
            placeholder="Spårningsnummer från fraktbolaget"
          />

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setForm(initial);
                setEditing(false);
              }}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              Avbryt
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
        </div>
      )}
    </div>
  );
}

function ShippingField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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
        className="w-full rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ── Statusflöde ─────────────────────────────────────────────────────────────

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

// ── Artiklar ────────────────────────────────────────────────────────────────

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

// ── Historik ────────────────────────────────────────────────────────────────

const EVENT_ICON: Record<OrderEvent["type"], typeof Package> = {
  created: Package,
  status_changed: ArrowRight,
  note_updated: NotebookPen,
  comment: MessageSquare,
  payment_changed: CreditCard,
  shipping_updated: Truck,
  invoice_created: Receipt,
  invoice_failed: X,
  invoice_paid: CreditCard,
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
          Statusändringar, betalning, frakt, anteckningar och kommentarer loggas här automatiskt.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-4">
      {events.map((event) => {
        const Icon = EVENT_ICON[event.type];
        const showDetail = event.detail && event.type !== "payment_changed";
        return (
          <li key={event.id} className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-card-foreground">{describeOrderEvent(event)}</p>
              {showDetail && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">”{event.detail}”</p>
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

// ── Intern anteckning ───────────────────────────────────────────────────────

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
      invalidateOrder(queryClient, orderId);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Anteckningen kunde inte sparas."),
  });

  const dirty = draft !== note;

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <CardTitle icon={NotebookPen}>Intern anteckning</CardTitle>
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
