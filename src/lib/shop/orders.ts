// Delade ordertyper för butiken (kundvyn) och verkstadsvyn.
// Själva datat bor i backend-tabellerna shop_orders / shop_order_lines.

export type ShopOrderStatus = "mottagen" | "behandlas" | "skickad" | "levererad";

export const ORDER_STATUS_LABELS: Record<ShopOrderStatus, string> = {
  mottagen: "Mottagen",
  behandlas: "Behandlas",
  skickad: "Skickad",
  levererad: "Levererad",
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as ShopOrderStatus[];

// Kort beskrivning av vad varje steg i flödet innebär — visas i orderöversikten.
export const ORDER_STATUS_HINTS: Record<ShopOrderStatus, string> = {
  mottagen: "Nya beställningar som ingen börjat med",
  behandlas: "Plockas eller förbereds i verkstaden",
  skickad: "Skickad eller redo för upphämtning",
  levererad: "Avslutad och levererad till kund",
};

// Tailwind-klasser per status. Används för både chips och badges.
export const ORDER_STATUS_BADGE: Record<ShopOrderStatus, string> = {
  mottagen: "bg-amber-100 text-amber-700",
  behandlas: "bg-sky-100 text-sky-700",
  skickad: "bg-violet-100 text-violet-700",
  levererad: "bg-emerald-100 text-emerald-700",
};

export const ORDER_STATUS_DOT: Record<ShopOrderStatus, string> = {
  mottagen: "bg-amber-500",
  behandlas: "bg-sky-500",
  skickad: "bg-violet-500",
  levererad: "bg-emerald-500",
};

// Nästa steg i flödet, eller null när ordern är klar.
export function nextOrderStatus(status: ShopOrderStatus): ShopOrderStatus | null {
  const index = ORDER_STATUSES.indexOf(status);
  return index >= 0 && index < ORDER_STATUSES.length - 1 ? ORDER_STATUSES[index + 1] : null;
}

export interface ShopOrderLine {
  productId: string;
  name: string;
  unit: string | null;
  unitPrice: number;
  quantity: number;
}

export interface ShopOrder {
  id: string;
  orderNumber: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  status: ShopOrderStatus;
  total: number;
  lines: ShopOrderLine[];
  // Kundinfo — fylls i för verkstadsvyn.
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  // Verkstadsintern info — bara satt i verkstadsvyn.
  internalNote?: string | null;
  messageCount?: number;
  unreadCount?: number;
  mentionsMe?: boolean;
}
