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
  status: ShopOrderStatus;
  total: number;
  lines: ShopOrderLine[];
  // Kundinfo — fylls i för verkstadsvyn.
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
}
