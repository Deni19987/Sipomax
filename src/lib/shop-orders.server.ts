import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEVELOPER_EMAILS,
  getUserAuthEmail,
  getWorkshopId,
  isDeveloperUser,
} from "./profile.server";
import { getProduct } from "./shop/catalog";
import type { ShopOrder, ShopOrderStatus } from "./shop/orders";

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
  created_at: string;
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
  "id, order_number, workshop_id, customer_user_id, customer_email, customer_name, customer_phone, status, total, created_at, shop_order_lines(product_id, name, unit, unit_price, quantity)";

function rowToOrder(row: OrderRow): ShopOrder {
  return {
    id: row.id,
    orderNumber: Number(row.order_number),
    createdAt: row.created_at,
    status: row.status,
    total: Number(row.total),
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    lines: (row.shop_order_lines ?? []).map((l) => ({
      productId: l.product_id,
      name: l.name,
      unit: l.unit,
      unitPrice: Number(l.unit_price),
      quantity: l.quantity,
    })),
  };
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

// ── Kund: lägga och läsa ordrar ─────────────────────────────────────────────

export async function createShopOrder(
  userId: string,
  items: Array<{ productId: string; quantity: number }>,
): Promise<ShopOrder> {
  if (items.length === 0) throw new Error("Varukorgen är tom.");

  const [workshopId, { data: prof }, email] = await Promise.all([
    resolveOrderWorkshopId(userId),
    admin.from("profiles").select("display_name, contact_phone").eq("id", userId).maybeSingle(),
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
      customer_phone: prof?.contact_phone ?? null,
      total,
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
  return ((data ?? []) as OrderRow[]).map(rowToOrder);
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
  return rowToOrder(data as OrderRow);
}

export async function updateShopOrderStatus(
  userId: string,
  orderId: string,
  status: ShopOrderStatus,
): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("shop_orders")
    .update({ status })
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Beställningen kunde inte hittas.");
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

export type ChatMessage = {
  id: string;
  orderId: string | null;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
};

export type ChatThread = {
  orderId: string | null; // null = allmän kanal
  title: string;
  subtitle: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
};

type MessageRow = {
  id: string;
  order_id: string | null;
  sender_id: string;
  sender_email: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
};

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    orderId: row.order_id,
    senderId: row.sender_id,
    senderName: row.sender_name || row.sender_email || "Okänd",
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listChatThreads(userId: string): Promise<ChatThread[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const [{ data: orders, error: orderError }, { data: messages, error: msgError }] =
    await Promise.all([
      admin
        .from("shop_orders")
        .select("id, order_number, customer_name, customer_email, status, created_at")
        .eq("workshop_id", workshopId)
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("workshop_messages")
        .select("order_id, body, created_at")
        .eq("workshop_id", workshopId)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
  if (orderError) throw new Error(orderError.message);
  if (msgError) throw new Error(msgError.message);

  const byThread = new Map<string, { last: string; lastAt: string; count: number }>();
  for (const m of (messages ?? []) as Array<{
    order_id: string | null;
    body: string;
    created_at: string;
  }>) {
    const key = m.order_id ?? "general";
    const entry = byThread.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      byThread.set(key, { last: m.body, lastAt: m.created_at, count: 1 });
    }
  }

  const general = byThread.get("general");
  const threads: ChatThread[] = [
    {
      orderId: null,
      title: "Allmänt",
      subtitle: "Hela verkstaden",
      lastMessage: general?.last ?? null,
      lastMessageAt: general?.lastAt ?? null,
      messageCount: general?.count ?? 0,
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
    const entry = byThread.get(o.id);
    threads.push({
      orderId: o.id,
      title: `Order #${o.order_number}`,
      subtitle: o.customer_name || o.customer_email || null,
      lastMessage: entry?.last ?? null,
      lastMessageAt: entry?.lastAt ?? null,
      messageCount: entry?.count ?? 0,
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
    .select("id, order_id, sender_id, sender_email, sender_name, body, created_at")
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: true })
    .limit(300);
  query = orderId === null ? query.is("order_id", null) : query.eq("order_id", orderId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as MessageRow[]).map(rowToMessage);
}

export async function sendChatMessage(
  userId: string,
  orderId: string | null,
  body: string,
): Promise<ChatMessage> {
  const workshopId = await assertWorkshopAccount(userId);
  if (orderId) {
    const { data: order } = await admin
      .from("shop_orders")
      .select("id")
      .eq("id", orderId)
      .eq("workshop_id", workshopId)
      .maybeSingle();
    if (!order) throw new Error("Ordern tillhör inte din verkstad.");
  }
  const [email, { data: prof }] = await Promise.all([
    getUserAuthEmail(userId),
    admin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);
  const { data, error } = await admin
    .from("workshop_messages")
    .insert({
      workshop_id: workshopId,
      order_id: orderId,
      sender_id: userId,
      sender_email: email,
      sender_name: prof?.display_name ?? null,
      body,
    })
    .select("id, order_id, sender_id, sender_email, sender_name, body, created_at")
    .single();
  if (error) throw new Error(error.message);
  return rowToMessage(data as MessageRow);
}
