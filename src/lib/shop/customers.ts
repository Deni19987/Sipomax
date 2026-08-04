// Delade kundtyper för verkstadens kundregister och kundkort.
// Datat bor i profiles (account_type = 'customer') och shop_orders.

import type { ShopOrder } from "./orders";

export type ShopCustomerDetails = {
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

export type ShopCustomerSummary = ShopCustomerDetails & {
  id: string;
  email: string | null;
  createdAt: string | null;
  /** Ingen inloggning ännu — inbjudan är fortfarande obesvarad. */
  pending: boolean;
  orderCount: number;
  /** Ordrar som ännu inte är både levererade och betalda. */
  openOrderCount: number;
  totalSpent: number;
  /** Summan på ordrar som varken är betalda eller återbetalda. */
  outstanding: number;
  lastOrderAt: string | null;
};

export type ShopCustomerCard = ShopCustomerSummary & {
  /** Pågående ordrar — allt som inte är både levererat och betalt. */
  activeOrders: ShopOrder[];
  /** Historik — färdiga beställningar, levererade och betalda. */
  completedOrders: ShopOrder[];
};

/** Namnet som visas i listor och rubriker, med rimliga fallbacks. */
export function customerLabel(
  customer: Pick<ShopCustomerSummary, "displayName" | "companyName" | "email">,
): string {
  return customer.displayName || customer.companyName || customer.email || "Namnlös kund";
}
