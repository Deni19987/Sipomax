// Filtrering, sortering och gruppering av verkstadens orderlista.
//
// Prioriteringen bygger på hur listan faktiskt används i verkstaden:
//  1. "Var i flödet ligger ordern?" — status är den dominerande frågan och
//     ligger därför som vyflikar, alltid synliga, ett klick bort.
//  2. "Finns det något jag måste svara på?" — olästa kommentarer och
//     omnämnanden av mig själv, som egna snabbknappar bredvid sökrutan.
//  3. "Vad kom in nyligen?" — perioden i en egen synlig meny.
//  4. Långsvansen (ordervärde, anteckningar, har kommentarer) samlas i en
//     enda Filter-meny så att grundvyn förblir lugn.

import type { ShopOrder, ShopOrderStatus } from "./orders";
import { ORDER_STATUSES, ORDER_STATUS_HINTS, ORDER_STATUS_LABELS, hasAddress } from "./orders";

// ── Vyer (flikarna) ─────────────────────────────────────────────────────────

export type OrderView = "alla" | ShopOrderStatus;

export const ORDER_VIEWS: OrderView[] = ["alla", ...ORDER_STATUSES];

export const ORDER_VIEW_LABELS: Record<OrderView, string> = {
  alla: "Alla",
  ...ORDER_STATUS_LABELS,
};

export const ORDER_VIEW_HINTS: Record<OrderView, string> = {
  alla: "Alla öppna beställningar i verkstaden",
  ...ORDER_STATUS_HINTS,
};

function matchesView(order: ShopOrder, view: OrderView): boolean {
  if (view === "alla") return true;
  return order.status === view;
}

// ── Period ──────────────────────────────────────────────────────────────────

export type OrderPeriod = "alla" | "idag" | "7d" | "30d";

export const ORDER_PERIODS: OrderPeriod[] = ["alla", "idag", "7d", "30d"];

export const ORDER_PERIOD_LABELS: Record<OrderPeriod, string> = {
  alla: "Hela tiden",
  idag: "Idag",
  "7d": "Senaste 7 dagarna",
  "30d": "Senaste 30 dagarna",
};

function matchesPeriod(order: ShopOrder, period: OrderPeriod, now: Date): boolean {
  if (period === "alla") return true;
  const created = new Date(order.createdAt);
  if (period === "idag") return created.toDateString() === now.toDateString();
  const days = period === "7d" ? 7 : 30;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return created >= cutoff;
}

// ── Ordervärde ──────────────────────────────────────────────────────────────

export type OrderAmount = "alla" | "500" | "1000" | "5000";

export const ORDER_AMOUNTS: OrderAmount[] = ["alla", "500", "1000", "5000"];

export const ORDER_AMOUNT_LABELS: Record<OrderAmount, string> = {
  alla: "Alla belopp",
  "500": "Minst 500 kr",
  "1000": "Minst 1 000 kr",
  "5000": "Minst 5 000 kr",
};

function matchesAmount(order: ShopOrder, amount: OrderAmount): boolean {
  return amount === "alla" || order.total >= Number(amount);
}

// ── Antal artiklar ──────────────────────────────────────────────────────────

export type OrderSize = "alla" | "1" | "5" | "20";

export const ORDER_SIZES: OrderSize[] = ["alla", "1", "5", "20"];

export const ORDER_SIZE_LABELS: Record<OrderSize, string> = {
  alla: "Alla storlekar",
  "1": "Endast en artikel",
  "5": "Minst 5 artiklar",
  "20": "Minst 20 artiklar",
};

function itemCount(order: ShopOrder): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
}

function matchesSize(order: ShopOrder, size: OrderSize): boolean {
  if (size === "alla") return true;
  const count = itemCount(order);
  return size === "1" ? count === 1 : count >= Number(size);
}

// ── Sortering ───────────────────────────────────────────────────────────────

export type OrderSort = "nyast" | "aldst" | "varde" | "uppdaterad";

export const ORDER_SORTS: OrderSort[] = ["nyast", "aldst", "varde", "uppdaterad"];

export const ORDER_SORT_LABELS: Record<OrderSort, string> = {
  nyast: "Nyast först",
  aldst: "Äldst först",
  varde: "Högst ordervärde",
  uppdaterad: "Senast ändrad",
};

// ── Samlat filtertillstånd ──────────────────────────────────────────────────

export type OrderFilters = {
  view: OrderView;
  query: string;
  period: OrderPeriod;
  amount: OrderAmount;
  /** Antal artiklar på ordern. */
  size: OrderSize;
  /** Bara ordrar med olästa kommentarer. */
  unread: boolean;
  /** Bara ordrar där jag själv blivit taggad. */
  mentioned: boolean;
  /** Bara ordrar som har minst en kommentar. */
  commented: boolean;
  /** Bara ordrar med en intern anteckning. */
  noted: boolean;
  /** Bara ordrar utan komplett leveransadress. */
  missingAddress: boolean;
  /** Bara ordrar utan kollinummer. */
  missingTracking: boolean;
  sort: OrderSort;
};

export const DEFAULT_FILTERS: OrderFilters = {
  view: "alla",
  query: "",
  period: "alla",
  amount: "alla",
  size: "alla",
  unread: false,
  mentioned: false,
  commented: false,
  noted: false,
  missingAddress: false,
  missingTracking: false,
  sort: "nyast",
};

function matchesQuery(order: ShopOrder, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return [
    String(order.orderNumber),
    order.customerName ?? "",
    order.customerEmail ?? "",
    order.customerPhone ?? "",
    order.internalNote ?? "",
    ...order.lines.map((line) => line.name),
  ]
    .join(" ")
    .toLowerCase()
    .includes(term);
}

/**
 * Allt utom vyflikarna. Bryts ut så att flikarnas antal kan räknas mot samma
 * urval som listan visar — annars lovar en flik träffar som filtren sedan
 * plockar bort, vilket är precis den förvirring vi vill undvika.
 */
export function matchesRefinements(
  order: ShopOrder,
  filters: OrderFilters,
  now: Date = new Date(),
): boolean {
  if (!matchesQuery(order, filters.query)) return false;
  if (!matchesPeriod(order, filters.period, now)) return false;
  if (!matchesAmount(order, filters.amount)) return false;
  if (!matchesSize(order, filters.size)) return false;
  if (filters.unread && (order.unreadCount ?? 0) === 0) return false;
  if (filters.mentioned && !order.mentionsMe) return false;
  if (filters.commented && (order.messageCount ?? 0) === 0) return false;
  if (filters.noted && !order.internalNote?.trim()) return false;
  if (filters.missingAddress && hasAddress(order.shipping)) return false;
  if (filters.missingTracking && !!order.trackingNumber?.trim()) return false;
  return true;
}

export function sortOrders(orders: ShopOrder[], sort: OrderSort): ShopOrder[] {
  const sorted = [...orders];
  switch (sort) {
    case "aldst":
      return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "varde":
      return sorted.sort((a, b) => b.total - a.total);
    case "uppdaterad":
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case "nyast":
    default:
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export function filterOrders(
  orders: ShopOrder[],
  filters: OrderFilters,
  now: Date = new Date(),
): ShopOrder[] {
  const matched = orders.filter(
    (order) => matchesView(order, filters.view) && matchesRefinements(order, filters, now),
  );
  return sortOrders(matched, filters.sort);
}

/** Antal per flik, räknat mot de övriga aktiva filtren. */
export function countByView(
  orders: ShopOrder[],
  filters: OrderFilters,
  now: Date = new Date(),
): Record<OrderView, number> {
  const counts = Object.fromEntries(ORDER_VIEWS.map((view) => [view, 0])) as Record<
    OrderView,
    number
  >;
  for (const order of orders) {
    if (!matchesRefinements(order, filters, now)) continue;
    for (const view of ORDER_VIEWS) {
      if (matchesView(order, view)) counts[view] += 1;
    }
  }
  return counts;
}

// ── Aktiva filter som chips ─────────────────────────────────────────────────

export type FilterChipInfo = {
  key: keyof OrderFilters;
  label: string;
};

/** De filter som avviker från standardläget, för chip-raden. */
export function activeFilterChips(filters: OrderFilters): FilterChipInfo[] {
  const chips: FilterChipInfo[] = [];
  if (filters.period !== "alla") {
    chips.push({ key: "period", label: ORDER_PERIOD_LABELS[filters.period] });
  }
  if (filters.amount !== "alla") {
    chips.push({ key: "amount", label: ORDER_AMOUNT_LABELS[filters.amount] });
  }
  if (filters.size !== "alla") {
    chips.push({ key: "size", label: ORDER_SIZE_LABELS[filters.size] });
  }
  if (filters.unread) chips.push({ key: "unread", label: "Olästa kommentarer" });
  if (filters.mentioned) chips.push({ key: "mentioned", label: "Jag är taggad" });
  if (filters.commented) chips.push({ key: "commented", label: "Har kommentarer" });
  if (filters.noted) chips.push({ key: "noted", label: "Har intern anteckning" });
  if (filters.missingAddress) chips.push({ key: "missingAddress", label: "Saknar leveransadress" });
  if (filters.missingTracking) chips.push({ key: "missingTracking", label: "Saknar kollinummer" });
  if (filters.query.trim()) chips.push({ key: "query", label: `”${filters.query.trim()}”` });
  return chips;
}

export function clearFilterKey(filters: OrderFilters, key: keyof OrderFilters): OrderFilters {
  return { ...filters, [key]: DEFAULT_FILTERS[key] };
}

/** Nollställer allt utom vyfliken — fliken är ett eget val, inte ett filter. */
export function clearRefinements(filters: OrderFilters): OrderFilters {
  return { ...DEFAULT_FILTERS, view: filters.view, sort: filters.sort };
}

// ── Datumgrupper i listan ───────────────────────────────────────────────────

/** Rubrik för dagsgruppen en order hör till, t.ex. "Idag" eller "14 juli". */
export function dayGroupLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Idag";
  if (date.toDateString() === yesterday.toDateString()) return "Igår";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Dagsgrupper är bara meningsfulla när listan är sorterad på datum. */
export function groupsByDay(sort: OrderSort): boolean {
  return sort === "nyast" || sort === "aldst";
}
