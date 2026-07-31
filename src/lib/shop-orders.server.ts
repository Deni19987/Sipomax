import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEVELOPER_EMAILS,
  getUserAuthEmail,
  getWorkshopId,
  isDeveloperUser,
} from "./profile.server";
import { sendPushToUser, sendPushToWorkshop } from "./push.server";
import { getProduct } from "./shop/catalog";
import { EMPTY_DELIVERY, type DeliveryDetails } from "./shop/delivery";
import {
  GENERAL_THREAD,
  plainChatBody,
  type ChatMessage,
  type ChatThread,
  type OrderRef,
  type WorkshopMember,
} from "./shop/chat";
import type {
  OrderEvent,
  OrderEventType,
  PaymentStatus,
  ShippingAddress,
  ShopOrder,
  ShopOrderStatus,
} from "./shop/orders";
import { PAYMENT_STATUS_LABELS } from "./shop/orders";

// De nya butiks-tabellerna finns ännu inte i den plattformsgenererade
// Database-typen (src/integrations/supabase/types.ts får inte redigeras),
// så vi går via en otypad klient och typar resultaten själva.
const admin = supabaseAdmin as unknown as SupabaseClient;

type OrderRow = {
  id: string;
  order_number: number;
  workshop_id: string;
  customer_user_id: string;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: ShopOrderStatus;
  total: number;
  payment_status: PaymentStatus;
  shipping_recipient: string | null;
  shipping_street: string | null;
  shipping_postal_code: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  carrier: string | null;
  tracking_number: string | null;
  note: string | null;
  internal_note: string | null;
  created_at: string;
  updated_at: string;
  shop_order_lines?: LineRow[];
};

type LineRow = {
  product_id: string;
  name: string;
  unit: string | null;
  unit_price: number;
  quantity: number;
};

const ORDER_SELECT =
  "id, order_number, workshop_id, customer_user_id, customer_email, customer_name, customer_phone, status, total, note, payment_status, shipping_recipient, shipping_street, shipping_postal_code, shipping_city, shipping_country, carrier, tracking_number, internal_note, created_at, updated_at, shop_order_lines(product_id, name, unit, unit_price, quantity)";

function rowToOrder(row: OrderRow): ShopOrder {
  return {
    id: row.id,
    orderNumber: Number(row.order_number),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    status: row.status,
    total: Number(row.total),
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    paymentStatus: row.payment_status ?? "obetald",
    shipping: {
      recipient: row.shipping_recipient,
      street: row.shipping_street,
      postalCode: row.shipping_postal_code,
      city: row.shipping_city,
      country: row.shipping_country,
    },
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    deliveryNote: row.note,
    lines: (row.shop_order_lines ?? []).map((l) => ({
      productId: l.product_id,
      name: l.name,
      unit: l.unit,
      unitPrice: Number(l.unit_price),
      quantity: l.quantity,
    })),
  };
}

// Verkstadsvyn får med den interna anteckningen; kundvyn ska aldrig se den,
// därför lever den bara i den här varianten.
function rowToWorkshopOrder(row: OrderRow): ShopOrder {
  return { ...rowToOrder(row), internalNote: row.internal_note ?? null };
}

export type AccountType = "workshop" | "customer";

export type AccountInfo = {
  accountType: AccountType;
  isDeveloper: boolean;
  email: string | null;
  displayName: string | null;
};

export async function getAccountInfo(userId: string): Promise<AccountInfo> {
  const [{ data: prof }, email, isDeveloper] = await Promise.all([
    admin.from("profiles").select("account_type, display_name").eq("id", userId).maybeSingle(),
    getUserAuthEmail(userId),
    isDeveloperUser(userId),
  ]);
  const accountType: AccountType = prof?.account_type === "customer" ? "customer" : "workshop";
  return { accountType, isDeveloper, email, displayName: prof?.display_name ?? null };
}

// Verkstaden en kunds ordrar hamnar hos: kundens kopplade verkstad, annars
// utvecklarens verkstad (butikens standardverkstad).
export async function resolveOrderWorkshopId(userId: string): Promise<string> {
  const { data: prof } = await admin
    .from("profiles")
    .select("customer_of_workshop_id")
    .eq("id", userId)
    .maybeSingle();
  if (prof?.customer_of_workshop_id) return prof.customer_of_workshop_id;

  const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  if (error) throw new Error(error.message);
  const dev = (users.users ?? []).find(
    (u) => u.email && DEVELOPER_EMAILS.has(u.email.toLowerCase()),
  );
  if (!dev) throw new Error("Butikens verkstadskonto kunde inte hittas.");
  return getWorkshopId(dev.id);
}

export async function assertWorkshopAccount(userId: string): Promise<string> {
  const { data: prof } = await admin
    .from("profiles")
    .select("account_type")
    .eq("id", userId)
    .maybeSingle();
  if (prof?.account_type === "customer") {
    throw new Error("Endast verkstadskonton har tillgång till verkstadsvyn.");
  }
  return getWorkshopId(userId);
}

// ── Orderhistorik ───────────────────────────────────────────────────────────

// Varje åtgärd på en order loggas här. Loggningen får aldrig fälla själva
// åtgärden — en trasig historikrad är mindre allvarlig än en utebliven
// statusändring.
async function logOrderEvent(input: {
  orderId: string;
  workshopId: string;
  actorId: string | null;
  actorName: string | null;
  type: OrderEventType;
  fromStatus?: ShopOrderStatus | null;
  toStatus?: ShopOrderStatus | null;
  detail?: string | null;
}): Promise<void> {
  const { error } = await admin.from("shop_order_events").insert({
    order_id: input.orderId,
    workshop_id: input.workshopId,
    actor_id: input.actorId,
    actor_name: input.actorName,
    type: input.type,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    detail: input.detail ?? null,
  });
  if (error) console.error("[orders] failed to log event", input.type, error.message);
}

// Namnet som visas i historiken för en inloggad medarbetare.
async function actorNameFor(userId: string): Promise<string> {
  const [{ data: prof }, email] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    getUserAuthEmail(userId),
  ]);
  return prof?.display_name || email || "En medarbetare";
}

export async function listOrderEvents(userId: string, orderId: string): Promise<OrderEvent[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("shop_order_events")
    .select("id, type, actor_name, from_status, to_status, detail, created_at")
    .eq("order_id", orderId)
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as Array<{
      id: string;
      type: OrderEventType;
      actor_name: string | null;
      from_status: ShopOrderStatus | null;
      to_status: ShopOrderStatus | null;
      detail: string | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    type: row.type,
    actorName: row.actor_name,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

// ── Kundkortet: sparade leveransuppgifter ───────────────────────────────────

const DELIVERY_SELECT =
  "delivery_recipient, delivery_street, delivery_postal_code, delivery_city, delivery_country, delivery_note, contact_phone, display_name, company_name";

type DeliveryRow = {
  delivery_recipient: string | null;
  delivery_street: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  delivery_country: string | null;
  delivery_note: string | null;
  contact_phone: string | null;
  display_name: string | null;
  company_name: string | null;
};

/**
 * Kundens sparade leveransuppgifter. Har kunden inte sparat något ännu
 * förifylls mottagaren med företags- eller kontonamnet, så att formuläret
 * sällan är helt tomt.
 */
export async function getDeliveryDetails(userId: string): Promise<{
  details: DeliveryDetails;
  saved: boolean;
}> {
  const { data, error } = await admin
    .from("profiles")
    .select(DELIVERY_SELECT)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? null) as DeliveryRow | null;
  const saved = !!row?.delivery_street?.trim();

  return {
    saved,
    details: {
      ...EMPTY_DELIVERY,
      recipient: row?.delivery_recipient || row?.company_name || row?.display_name || "",
      street: row?.delivery_street ?? "",
      postalCode: row?.delivery_postal_code ?? "",
      city: row?.delivery_city ?? "",
      country: row?.delivery_country || EMPTY_DELIVERY.country,
      phone: row?.contact_phone ?? "",
      note: row?.delivery_note ?? "",
    },
  };
}

export async function saveDeliveryDetails(userId: string, details: DeliveryDetails): Promise<void> {
  const value = (input: string) => input.trim() || null;
  const { error } = await admin
    .from("profiles")
    .update({
      delivery_recipient: value(details.recipient),
      delivery_street: value(details.street),
      delivery_postal_code: value(details.postalCode),
      delivery_city: value(details.city),
      delivery_country: value(details.country),
      delivery_note: value(details.note),
      contact_phone: value(details.phone),
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/** Tömmer kundkortets sparade uppgifter. */
export async function clearDeliveryDetails(userId: string): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({
      delivery_recipient: null,
      delivery_street: null,
      delivery_postal_code: null,
      delivery_city: null,
      delivery_country: null,
      delivery_note: null,
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

// ── Kund: lägga och läsa ordrar ─────────────────────────────────────────────

export async function createShopOrder(
  userId: string,
  items: Array<{ productId: string; quantity: number }>,
  delivery: DeliveryDetails,
  saveDetails: boolean,
): Promise<ShopOrder> {
  if (items.length === 0) throw new Error("Varukorgen är tom.");

  const [workshopId, { data: prof }, email] = await Promise.all([
    resolveOrderWorkshopId(userId),
    admin.from("profiles").select("display_name, company_name").eq("id", userId).maybeSingle(),
    getUserAuthEmail(userId),
  ]);

  // Priser hämtas alltid server-side: ur den statiska katalogen eller ur
  // verkstadens publicerade egna produkter — aldrig från klienten.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const customIds = items
    .map((i) => i.productId)
    .filter((id) => !getProduct(id) && uuidRe.test(id));
  const customMap = new Map<string, { name: string; unit: string | null; price: number }>();
  if (customIds.length > 0) {
    const { data: customs, error: customError } = await admin
      .from("workshop_products")
      .select("id, name, unit, price")
      .in("id", customIds)
      .eq("workshop_id", workshopId)
      .eq("status", "published");
    if (customError) throw new Error(customError.message);
    for (const p of (customs ?? []) as Array<{
      id: string;
      name: string;
      unit: string | null;
      price: number;
    }>) {
      customMap.set(p.id, { name: p.name, unit: p.unit, price: Number(p.price) });
    }
  }

  const lines = items.map((item) => {
    const product = getProduct(item.productId);
    if (product) {
      return {
        product_id: product.id,
        name: product.name,
        unit: product.unit,
        unit_price: product.price,
        quantity: item.quantity,
      };
    }
    const custom = customMap.get(item.productId);
    if (!custom) throw new Error(`Okänd produkt: ${item.productId}`);
    return {
      product_id: item.productId,
      name: custom.name,
      unit: custom.unit,
      unit_price: custom.price,
      quantity: item.quantity,
    };
  });
  const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);

  const { data: order, error } = await admin
    .from("shop_orders")
    .insert({
      workshop_id: workshopId,
      customer_user_id: userId,
      customer_email: email,
      customer_name: prof?.display_name ?? null,
      customer_phone: delivery.phone.trim() || null,
      total,
      // Leveransuppgifterna kommer från kassan. Verkstaden kan justera dem på
      // ordern efteråt utan att kundens sparade uppgifter ändras.
      shipping_recipient: delivery.recipient.trim() || null,
      shipping_street: delivery.street.trim() || null,
      shipping_postal_code: delivery.postalCode.trim() || null,
      shipping_city: delivery.city.trim() || null,
      shipping_country: delivery.country.trim() || null,
      note: delivery.note.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: lineError } = await admin
    .from("shop_order_lines")
    .insert(lines.map((l) => ({ ...l, order_id: order.id })));
  if (lineError) {
    await admin.from("shop_orders").delete().eq("id", order.id);
    throw new Error(lineError.message);
  }

  // Kunden kan välja att spara uppgifterna på sitt kundkort. Ett fel här får
  // inte fälla en order som redan är lagd.
  if (saveDetails) {
    try {
      await saveDeliveryDetails(userId, delivery);
    } catch (err) {
      console.error("[shop] could not save delivery details", err);
    }
  }

  await logOrderEvent({
    orderId: order.id,
    workshopId,
    actorId: userId,
    actorName: prof?.display_name || email || "Kunden",
    type: "created",
    toStatus: "mottagen",
  });

  // Heads-up till hela verkstaden om att en ny beställning kommit in. En
  // misslyckad notis får aldrig fälla själva beställningen.
  try {
    const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
    await sendPushToWorkshop(workshopId, {
      title: "Ny beställning",
      body: `${prof?.display_name || email || "En kund"} · ${itemCount} artiklar · ${total.toFixed(0)} kr`,
      url: `/verkstad?order=${order.id}`,
      tag: `order-${order.id}`,
    });
  } catch (err) {
    console.error("[shop] new order push failed", err);
  }

  return getOrderForCustomer(userId, order.id);
}

export async function listCustomerOrders(userId: string): Promise<ShopOrder[]> {
  const { data, error } = await admin
    .from("shop_orders")
    .select(ORDER_SELECT)
    .eq("customer_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as OrderRow[]).map(rowToOrder);
}

export async function getOrderForCustomer(userId: string, orderId: string): Promise<ShopOrder> {
  const { data, error } = await admin
    .from("shop_orders")
    .select(ORDER_SELECT)
    .eq("id", orderId)
    .eq("customer_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Beställningen kunde inte hittas.");
  return rowToOrder(data as OrderRow);
}

// ── Verkstad: orderlista, status, statistik ─────────────────────────────────

export async function listWorkshopOrders(userId: string): Promise<ShopOrder[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("shop_orders")
    .select(ORDER_SELECT)
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  const orders = ((data ?? []) as OrderRow[]).map(rowToWorkshopOrder);
  const activity = await loadThreadActivity(workshopId, userId);
  return orders.map((order) => ({ ...order, ...threadCountsFor(activity, order.id) }));
}

export async function getWorkshopOrder(userId: string, orderId: string): Promise<ShopOrder> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("shop_orders")
    .select(ORDER_SELECT)
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Beställningen kunde inte hittas.");
  const activity = await loadThreadActivity(workshopId, userId);
  return {
    ...rowToWorkshopOrder(data as OrderRow),
    ...threadCountsFor(activity, orderId),
  };
}

// Lättviktig orderlista för #-taggning i chatten.
export async function listOrderRefs(userId: string, query: string): Promise<OrderRef[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const term = query.trim();
  let request = admin
    .from("shop_orders")
    .select("id, order_number, customer_name, customer_email, status")
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (term) {
    const digits = term.replace(/\D/g, "");
    const escaped = term.replace(/[%,()]/g, "");
    const filters = [`customer_name.ilike.%${escaped}%`, `customer_email.ilike.%${escaped}%`];
    // order_number är numeriskt — matcha bara när söktermen innehåller siffror.
    if (digits) filters.push(`order_number.eq.${digits}`);
    request = request.or(filters.join(","));
  }
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as Array<{
      id: string;
      order_number: number;
      customer_name: string | null;
      customer_email: string | null;
      status: string;
    }>
  ).map((o) => ({
    id: o.id,
    orderNumber: Number(o.order_number),
    customerName: o.customer_name || o.customer_email || null,
    status: o.status,
  }));
}

export async function updateOrderPaymentStatus(
  userId: string,
  orderId: string,
  paymentStatus: PaymentStatus,
): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("shop_orders")
    .update({ payment_status: paymentStatus })
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Beställningen kunde inte hittas.");

  await logOrderEvent({
    orderId,
    workshopId,
    actorId: userId,
    actorName: await actorNameFor(userId),
    type: "payment_changed",
    detail: PAYMENT_STATUS_LABELS[paymentStatus],
  });
}

export type ShippingInput = ShippingAddress & {
  carrier: string | null;
  trackingNumber: string | null;
};

export async function updateOrderShipping(
  userId: string,
  orderId: string,
  input: ShippingInput,
): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const trim = (value: string | null) => value?.trim() || null;
  const { data, error } = await admin
    .from("shop_orders")
    .update({
      shipping_recipient: trim(input.recipient),
      shipping_street: trim(input.street),
      shipping_postal_code: trim(input.postalCode),
      shipping_city: trim(input.city),
      shipping_country: trim(input.country),
      carrier: trim(input.carrier),
      tracking_number: trim(input.trackingNumber),
    })
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Beställningen kunde inte hittas.");

  const tracking = trim(input.trackingNumber);
  await logOrderEvent({
    orderId,
    workshopId,
    actorId: userId,
    actorName: await actorNameFor(userId),
    type: "shipping_updated",
    detail: tracking ? `Kollinummer ${tracking}` : null,
  });
}

export async function updateOrderInternalNote(
  userId: string,
  orderId: string,
  note: string,
): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("shop_orders")
    .update({ internal_note: note.trim() || null })
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Beställningen kunde inte hittas.");

  await logOrderEvent({
    orderId,
    workshopId,
    actorId: userId,
    actorName: await actorNameFor(userId),
    type: "note_updated",
    detail: note.trim() ? note.trim().slice(0, 200) : "Anteckningen tömdes",
  });
}

// Alla konton som hör till verkstaden — ägaren plus inbjudna medarbetare.
// Används av @-omnämnanden i ordertrådarna.
export async function listWorkshopMembers(userId: string): Promise<WorkshopMember[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name")
    .or(`id.eq.${workshopId},account_owner_id.eq.${workshopId}`);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; display_name: string | null }>;

  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emails = new Map<string, string | null>();
  for (const u of authUsers?.users ?? []) emails.set(u.id, u.email ?? null);

  return rows
    .map((row) => {
      const email = emails.get(row.id) ?? null;
      return {
        id: row.id,
        name: row.display_name || email || "Medarbetare",
        email,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

export async function updateShopOrderStatus(
  userId: string,
  orderId: string,
  status: ShopOrderStatus,
): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data: current } = await admin
    .from("shop_orders")
    .select("status")
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  const fromStatus = (current?.status ?? null) as ShopOrderStatus | null;

  const { data, error } = await admin
    .from("shop_orders")
    .update({ status })
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Beställningen kunde inte hittas.");

  if (fromStatus !== status) {
    await logOrderEvent({
      orderId,
      workshopId,
      actorId: userId,
      actorName: await actorNameFor(userId),
      type: "status_changed",
      fromStatus,
      toStatus: status,
    });
  }
}

export type WorkshopStats = {
  monthRevenue: number;
  monthOrders: number;
  monthCustomers: number;
  prevMonthRevenue: number;
  avgOrderValue: number;
  totalRevenue: number;
  totalOrders: number;
  statusCounts: Record<ShopOrderStatus, number>;
  dailySeries: Array<{ date: string; revenue: number; orders: number }>;
  monthlySeries: Array<{ month: string; revenue: number; orders: number }>;
  topProducts: Array<{ productId: string; name: string; quantity: number; revenue: number }>;
  topCustomers: Array<{ name: string; orders: number; revenue: number }>;
};

export async function getWorkshopStats(userId: string): Promise<WorkshopStats> {
  const workshopId = await assertWorkshopAccount(userId);
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const { data, error } = await admin
    .from("shop_orders")
    .select(ORDER_SELECT)
    .eq("workshop_id", workshopId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  const orders = ((data ?? []) as OrderRow[]).map(rowToOrder);

  const now = new Date();
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const thisMonth = monthKey(now);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = monthKey(prevMonthDate);

  const statusCounts: Record<ShopOrderStatus, number> = {
    mottagen: 0,
    behandlas: 0,
    skickad: 0,
    levererad: 0,
  };
  let monthRevenue = 0;
  let monthOrders = 0;
  let prevMonthRevenue = 0;
  const monthCustomerSet = new Set<string>();
  const byDay = new Map<string, { revenue: number; orders: number }>();
  const byMonth = new Map<string, { revenue: number; orders: number }>();
  const byProduct = new Map<string, { name: string; quantity: number; revenue: number }>();
  const byCustomer = new Map<string, { name: string; orders: number; revenue: number }>();

  for (const order of orders) {
    const created = new Date(order.createdAt);
    const mk = monthKey(created);
    statusCounts[order.status] += 1;

    const m = byMonth.get(mk) ?? { revenue: 0, orders: 0 };
    m.revenue += order.total;
    m.orders += 1;
    byMonth.set(mk, m);

    const dk = dayKey(created);
    const d = byDay.get(dk) ?? { revenue: 0, orders: 0 };
    d.revenue += order.total;
    d.orders += 1;
    byDay.set(dk, d);

    if (mk === thisMonth) {
      monthRevenue += order.total;
      monthOrders += 1;
      monthCustomerSet.add(order.customerEmail ?? order.customerName ?? "okänd");
    }
    if (mk === prevMonth) prevMonthRevenue += order.total;

    for (const line of order.lines) {
      const p = byProduct.get(line.productId) ?? { name: line.name, quantity: 0, revenue: 0 };
      p.quantity += line.quantity;
      p.revenue += line.unitPrice * line.quantity;
      byProduct.set(line.productId, p);
    }

    const customerLabel = order.customerName || order.customerEmail || "Okänd kund";
    const c = byCustomer.get(customerLabel) ?? { name: customerLabel, orders: 0, revenue: 0 };
    c.orders += 1;
    c.revenue += order.total;
    byCustomer.set(customerLabel, c);
  }

  // Senaste 30 dagarna, inklusive dagar utan ordrar.
  const dailySeries: WorkshopStats["dailySeries"] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const entry = byDay.get(key) ?? { revenue: 0, orders: 0 };
    dailySeries.push({ date: key, ...entry });
  }

  // Senaste 6 månaderna, inklusive tomma.
  const monthlySeries: WorkshopStats["monthlySeries"] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const entry = byMonth.get(key) ?? { revenue: 0, orders: 0 };
    monthlySeries.push({ month: key, ...entry });
  }

  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);

  return {
    monthRevenue,
    monthOrders,
    monthCustomers: monthCustomerSet.size,
    prevMonthRevenue,
    avgOrderValue: monthOrders > 0 ? monthRevenue / monthOrders : 0,
    totalRevenue,
    totalOrders: orders.length,
    statusCounts,
    dailySeries,
    monthlySeries,
    topProducts: [...byProduct.entries()]
      .map(([productId, p]) => ({ productId, ...p }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
    topCustomers: [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
  };
}

// ── Intern verkstadschatt ───────────────────────────────────────────────────

type MessageRow = {
  id: string;
  order_id: string | null;
  sender_id: string;
  sender_email: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
  mentions: string[] | null;
  order_refs: string[] | null;
};

const MESSAGE_SELECT =
  "id, order_id, sender_id, sender_email, sender_name, body, created_at, mentions, order_refs";

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    orderId: row.order_id,
    senderId: row.sender_id,
    senderName: row.sender_name || row.sender_email || "Okänd",
    body: row.body,
    createdAt: row.created_at,
    mentions: row.mentions ?? [],
    orderRefs: row.order_refs ?? [],
  };
}

function threadKeyOf(orderId: string | null): string {
  return orderId ?? GENERAL_THREAD;
}

type ThreadEntry = {
  last: string;
  lastAt: string;
  count: number;
  unread: number;
  mentionsMe: boolean;
};

// Sammanställer meddelandeaktivitet per tråd för en användare: senaste
// meddelandet, totalt antal och hur många som kommit in sedan hen läste
// tråden senast (egna meddelanden räknas aldrig som olästa).
async function loadThreadActivity(
  workshopId: string,
  userId: string,
): Promise<Map<string, ThreadEntry>> {
  const [{ data: messages, error: msgError }, { data: reads }] = await Promise.all([
    admin
      .from("workshop_messages")
      .select("order_id, body, created_at, sender_id, mentions")
      .eq("workshop_id", workshopId)
      .order("created_at", { ascending: false })
      .limit(2000),
    admin
      .from("workshop_thread_reads")
      .select("thread_key, last_read_at")
      .eq("user_id", userId)
      .eq("workshop_id", workshopId),
  ]);
  if (msgError) throw new Error(msgError.message);

  const readAt = new Map<string, string>();
  for (const r of (reads ?? []) as Array<{ thread_key: string; last_read_at: string }>) {
    readAt.set(r.thread_key, r.last_read_at);
  }

  const byThread = new Map<string, ThreadEntry>();
  for (const m of (messages ?? []) as Array<{
    order_id: string | null;
    body: string;
    created_at: string;
    sender_id: string;
    mentions: string[] | null;
  }>) {
    const key = threadKeyOf(m.order_id);
    let entry = byThread.get(key);
    if (!entry) {
      // Första träffen är den senaste, listan är sorterad fallande.
      entry = {
        last: plainChatBody(m.body),
        lastAt: m.created_at,
        count: 0,
        unread: 0,
        mentionsMe: false,
      };
      byThread.set(key, entry);
    }
    entry.count += 1;

    const since = readAt.get(key);
    const isNew = m.sender_id !== userId && (!since || m.created_at > since);
    if (isNew) {
      entry.unread += 1;
      if ((m.mentions ?? []).includes(userId)) entry.mentionsMe = true;
    }
  }
  return byThread;
}

function threadCountsFor(
  activity: Map<string, ThreadEntry>,
  orderId: string | null,
): { messageCount: number; unreadCount: number; mentionsMe: boolean } {
  const entry = activity.get(threadKeyOf(orderId));
  return {
    messageCount: entry?.count ?? 0,
    unreadCount: entry?.unread ?? 0,
    mentionsMe: entry?.mentionsMe ?? false,
  };
}

export async function listChatThreads(userId: string): Promise<ChatThread[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const [{ data: orders, error: orderError }, activity] = await Promise.all([
    admin
      .from("shop_orders")
      .select("id, order_number, customer_name, customer_email, status, created_at")
      .eq("workshop_id", workshopId)
      .order("created_at", { ascending: false })
      .limit(200),
    loadThreadActivity(workshopId, userId),
  ]);
  if (orderError) throw new Error(orderError.message);

  const general = activity.get(GENERAL_THREAD);
  const threads: ChatThread[] = [
    {
      orderId: null,
      title: "Allmänt",
      subtitle: "Hela verkstaden",
      lastMessage: general?.last ?? null,
      lastMessageAt: general?.lastAt ?? null,
      messageCount: general?.count ?? 0,
      unreadCount: general?.unread ?? 0,
      mentionsMe: general?.mentionsMe ?? false,
    },
  ];

  for (const o of (orders ?? []) as Array<{
    id: string;
    order_number: number;
    customer_name: string | null;
    customer_email: string | null;
    status: string;
    created_at: string;
  }>) {
    const entry = activity.get(o.id);
    threads.push({
      orderId: o.id,
      title: `Order #${o.order_number}`,
      subtitle: o.customer_name || o.customer_email || null,
      lastMessage: entry?.last ?? null,
      lastMessageAt: entry?.lastAt ?? null,
      messageCount: entry?.count ?? 0,
      unreadCount: entry?.unread ?? 0,
      mentionsMe: entry?.mentionsMe ?? false,
    });
  }

  // Trådar med aktivitet överst, därefter ordrar i datumordning (som hämtat).
  return threads.sort((a, b) => {
    if (a.orderId === null) return -1; // Allmänt alltid först
    if (b.orderId === null) return 1;
    return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
  });
}

export async function listChatMessages(
  userId: string,
  orderId: string | null,
): Promise<ChatMessage[]> {
  const workshopId = await assertWorkshopAccount(userId);
  let query = admin
    .from("workshop_messages")
    .select(MESSAGE_SELECT)
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: true })
    .limit(300);
  query = orderId === null ? query.is("order_id", null) : query.eq("order_id", orderId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as MessageRow[]).map(rowToMessage);
}

// Markerar tråden som läst fram till nu. Anropas när tråden öppnas/pollas.
export async function markThreadRead(userId: string, orderId: string | null): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const { error } = await admin.from("workshop_thread_reads").upsert(
    {
      workshop_id: workshopId,
      user_id: userId,
      thread_key: threadKeyOf(orderId),
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,thread_key" },
  );
  if (error) throw new Error(error.message);
}

export async function sendChatMessage(
  userId: string,
  orderId: string | null,
  body: string,
  mentions: string[] = [],
  orderRefs: string[] = [],
): Promise<ChatMessage> {
  const workshopId = await assertWorkshopAccount(userId);
  let orderNumber: number | null = null;
  if (orderId) {
    const { data: order } = await admin
      .from("shop_orders")
      .select("id, order_number")
      .eq("id", orderId)
      .eq("workshop_id", workshopId)
      .maybeSingle();
    if (!order) throw new Error("Ordern tillhör inte din verkstad.");
    orderNumber = Number(order.order_number);
  }

  // Bara medarbetare i den egna verkstaden får taggas — en klient som skickar
  // godtyckliga id:n ska inte kunna trigga notiser till andra konton.
  let validMentions: string[] = [];
  if (mentions.length > 0) {
    const { data: memberRows } = await admin
      .from("profiles")
      .select("id")
      .or(`id.eq.${workshopId},account_owner_id.eq.${workshopId}`);
    const memberIds = new Set(((memberRows ?? []) as Array<{ id: string }>).map((m) => m.id));
    validMentions = [...new Set(mentions)].filter((id) => memberIds.has(id));
  }

  const [email, { data: prof }] = await Promise.all([
    getUserAuthEmail(userId),
    admin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);
  const senderName = prof?.display_name || email || "En kollega";

  const { data, error } = await admin
    .from("workshop_messages")
    .insert({
      workshop_id: workshopId,
      order_id: orderId,
      sender_id: userId,
      sender_email: email,
      sender_name: prof?.display_name ?? null,
      body,
      mentions: validMentions,
      order_refs: [...new Set(orderRefs)],
    })
    .select(MESSAGE_SELECT)
    .single();
  if (error) throw new Error(error.message);

  if (orderId) {
    await logOrderEvent({
      orderId,
      workshopId,
      actorId: userId,
      actorName: senderName,
      type: "comment",
      detail: plainChatBody(body).slice(0, 200),
    });
  }

  // Avsändaren notifieras aldrig om sig själv.
  const targets = validMentions.filter((id) => id !== userId);
  if (targets.length > 0) {
    const preview = plainChatBody(body).slice(0, 140);
    const url = orderId ? `/verkstad?order=${orderId}` : `/verkstad/chatt?trad=${GENERAL_THREAD}`;
    const title = orderId
      ? `${senderName} taggade dig i order #${orderNumber}`
      : `${senderName} taggade dig`;
    await Promise.all(
      targets.map((id) =>
        sendPushToUser(id, {
          title,
          body: preview,
          url,
          tag: `chat-${threadKeyOf(orderId)}`,
        }).catch((err) => {
          console.error("[chat] mention push failed", err);
          return null;
        }),
      ),
    );
  }

  return rowToMessage(data as MessageRow);
}
