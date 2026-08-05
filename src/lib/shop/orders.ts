// Delade ordertyper för butiken (kundvyn) och verkstadsvyn.
// Själva datat bor i backend-tabellerna shop_orders / shop_order_lines.

export type ShopOrderStatus = "mottagen" | "packad" | "skickad" | "levererad" | "avklarad";

export const ORDER_STATUS_LABELS: Record<ShopOrderStatus, string> = {
  mottagen: "Mottagen",
  packad: "Packad",
  skickad: "Skickad",
  levererad: "Levererad",
  avklarad: "Avklarad",
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as ShopOrderStatus[];

// Kort beskrivning av vad varje steg i flödet innebär — visas i orderöversikten.
export const ORDER_STATUS_HINTS: Record<ShopOrderStatus, string> = {
  mottagen: "Nya beställningar som ingen börjat med",
  packad: "Plockad och packad, redo att skickas",
  skickad: "Skickad eller redo för upphämtning",
  levererad: "Levererad till kund — faktura skapad, väntar på betalning",
  avklarad: "Fakturan är betald i Fortnox och ordern är klar",
};

// Tailwind-klasser per status. Används för både chips och badges.
export const ORDER_STATUS_BADGE: Record<ShopOrderStatus, string> = {
  mottagen: "bg-amber-100 text-amber-700",
  packad: "bg-sky-100 text-sky-700",
  skickad: "bg-violet-100 text-violet-700",
  levererad: "bg-teal-100 text-teal-700",
  avklarad: "bg-emerald-100 text-emerald-700",
};

export const ORDER_STATUS_DOT: Record<ShopOrderStatus, string> = {
  mottagen: "bg-amber-500",
  packad: "bg-sky-500",
  skickad: "bg-violet-500",
  levererad: "bg-teal-500",
  avklarad: "bg-emerald-500",
};

// Nästa steg i flödet, eller null när ordern är klar. Status flyttas bara
// framåt ett steg i taget — det finns medvetet ingen väljare för fritt val.
export function nextOrderStatus(status: ShopOrderStatus): ShopOrderStatus | null {
  const index = ORDER_STATUSES.indexOf(status);
  return index >= 0 && index < ORDER_STATUSES.length - 1 ? ORDER_STATUSES[index + 1] : null;
}

// Föregående steg, används av ångra-åtgärden i ordermenyn.
export function previousOrderStatus(status: ShopOrderStatus): ShopOrderStatus | null {
  const index = ORDER_STATUSES.indexOf(status);
  return index > 0 ? ORDER_STATUSES[index - 1] : null;
}

// ── Orderhistorik ───────────────────────────────────────────────────────────

export type OrderEventType =
  | "created"
  | "status_changed"
  | "note_updated"
  | "comment"
  | "payment_changed"
  | "shipping_updated"
  | "invoice_created"
  | "invoice_failed"
  | "invoice_paid";

export interface OrderEvent {
  id: string;
  type: OrderEventType;
  actorName: string | null;
  fromStatus: ShopOrderStatus | null;
  toStatus: ShopOrderStatus | null;
  detail: string | null;
  createdAt: string;
}

// Läsbar rad i historiken.
export function describeOrderEvent(event: OrderEvent): string {
  const who = event.actorName || "Någon";
  switch (event.type) {
    case "created":
      return `${who} lade beställningen`;
    case "status_changed": {
      const to = event.toStatus ? ORDER_STATUS_LABELS[event.toStatus] : "okänd status";
      const from = event.fromStatus ? ORDER_STATUS_LABELS[event.fromStatus] : null;
      return from ? `${who} flyttade ordern från ${from} till ${to}` : `${who} satte status ${to}`;
    }
    case "note_updated":
      return `${who} uppdaterade den interna anteckningen`;
    case "comment":
      return `${who} kommenterade ordern`;
    case "payment_changed":
      return `${who} ändrade betalstatus till ${event.detail ?? "okänd"}`;
    case "shipping_updated":
      return `${who} uppdaterade frakt och leveransadress`;
    case "invoice_created":
      return `Faktura ${event.detail ?? ""} skapades i Fortnox`.trim();
    case "invoice_failed":
      return `Fakturan kunde inte skapas i Fortnox: ${event.detail ?? "okänt fel"}`;
    case "invoice_paid":
      return `Fakturan ${event.detail ?? ""} betalades i Fortnox`.trim();
  }
}

// ── Betalning ───────────────────────────────────────────────────────────────

export type PaymentStatus = "obetald" | "betald" | "fakturerad" | "retur" | "aterbetald";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  obetald: "Obetald",
  betald: "Betald",
  fakturerad: "Fakturerad",
  retur: "Retur",
  aterbetald: "Återbetald",
};

export const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[];

export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  obetald: "bg-rose-100 text-rose-700",
  betald: "bg-emerald-100 text-emerald-700",
  fakturerad: "bg-sky-100 text-sky-700",
  retur: "bg-orange-100 text-orange-700",
  aterbetald: "bg-neutral-200 text-neutral-700",
};

// Kort förklaring till varje betalstatus — visas i menyn som fälls ut när man
// klickar på en statusflik i orderlistan.
export const PAYMENT_STATUS_HINTS: Record<PaymentStatus, string> = {
  obetald: "Ingen faktura är betald ännu",
  betald: "Fakturan är betald i Fortnox",
  fakturerad: "Faktura skapad i Fortnox, väntar på betalning",
  retur: "Varorna är på väg tillbaka",
  aterbetald: "Pengarna är återbetalda till kunden",
};

// ── Frakt ───────────────────────────────────────────────────────────────────

export type CarrierInfo = {
  id: string;
  name: string;
  /** {id} byts mot kollinumret. Saknas den går sändningen inte att spåra. */
  trackingUrl?: string;
};

export const CARRIERS: CarrierInfo[] = [
  {
    id: "postnord",
    name: "PostNord",
    trackingUrl: "https://www.postnord.se/vara-verktyg/spara-brev-paket-och-pall?shipmentId={id}",
  },
  {
    id: "dhl",
    name: "DHL",
    trackingUrl: "https://www.dhl.com/se-sv/home/spara.html?tracking-id={id}",
  },
  {
    id: "schenker",
    name: "DB Schenker",
    trackingUrl: "https://www.dbschenker.com/app/tracking-public/?refNumber={id}&refType=stt",
  },
  { id: "bring", name: "Bring", trackingUrl: "https://tracking.bring.com/tracking.html?q={id}" },
  { id: "budbee", name: "Budbee", trackingUrl: "https://tracking.budbee.com/{id}" },
  { id: "egen", name: "Egen leverans" },
  { id: "upphamtning", name: "Upphämtning i verkstaden" },
];

export function getCarrier(id: string | null): CarrierInfo | undefined {
  return id ? CARRIERS.find((c) => c.id === id) : undefined;
}

export function trackingLink(
  carrierId: string | null,
  trackingNumber: string | null,
): string | null {
  const carrier = getCarrier(carrierId);
  if (!carrier?.trackingUrl || !trackingNumber?.trim()) return null;
  return carrier.trackingUrl.replace("{id}", encodeURIComponent(trackingNumber.trim()));
}

// ── Leveransadress ──────────────────────────────────────────────────────────

export interface ShippingAddress {
  recipient: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export const EMPTY_ADDRESS: ShippingAddress = {
  recipient: null,
  street: null,
  postalCode: null,
  city: null,
  country: null,
};

export function hasAddress(address: ShippingAddress): boolean {
  return !!(address.street?.trim() || address.city?.trim() || address.postalCode?.trim());
}

/** Adressen som rader, redo att visas eller kopieras till en fraktsedel. */
export function formatAddressLines(address: ShippingAddress): string[] {
  const postal = [address.postalCode, address.city].filter((p) => p?.trim()).join(" ");
  return [address.recipient, address.street, postal, address.country]
    .map((line) => line?.trim())
    .filter((line): line is string => !!line);
}

export interface ShopOrderLine {
  productId: string;
  name: string;
  unit: string | null;
  unitPrice: number;
  quantity: number;
}

// ── Faktura (Fortnox) ───────────────────────────────────────────────────────

/**
 * Fakturan som skapats i Fortnox för ordern. Samma uppgifter visas för
 * verkstaden och för kunden — kunden ser dem när hen öppnar sin beställning.
 */
export interface OrderInvoice {
  /** Fortnox fakturanummer (DocumentNumber). */
  invoiceId: string;
  createdAt: string | null;
  dueDate: string | null;
  total: number | null;
  /** Kvarvarande belopp i Fortnox. 0 = fullt betald. */
  balance: number | null;
  booked: boolean;
  paidAt: string | null;
}

export function invoiceStateLabel(invoice: OrderInvoice): string {
  if (invoice.paidAt) return "Betald";
  if (invoice.booked) return "Bokförd — väntar på betalning";
  return "Skapad i Fortnox";
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
  // Betalning och frakt.
  paymentStatus: PaymentStatus;
  shipping: ShippingAddress;
  carrier: string | null;
  trackingNumber: string | null;
  /** Kundens leveransinstruktion från kassan. */
  deliveryNote: string | null;
  /** Fortnox-fakturan, satt så fort ordern markerats som levererad. */
  invoice: OrderInvoice | null;
  /** Senaste felet från fakturaskapandet, bara satt i verkstadsvyn. */
  invoiceError?: string | null;
  // Verkstadsintern info — bara satt i verkstadsvyn.
  internalNote?: string | null;
  messageCount?: number;
  unreadCount?: number;
  mentionsMe?: boolean;
}
