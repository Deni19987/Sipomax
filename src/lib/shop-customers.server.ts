// Verkstadens kundregister.
//
// En kund är ett inloggningskonto i butiken (profiles.account_type = 'customer')
// som hör till en verkstad (profiles.customer_of_workshop_id). Kunder kan bara
// skapas här inifrån: verkstaden bjuder in en e-postadress, kunden får ett mejl
// och väljer sitt eget lösenord. Ingen självregistrering.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertWorkshopAccount } from "./shop-orders.server";
import type { ShopCustomerCard, ShopCustomerDetails, ShopCustomerSummary } from "./shop/customers";
import type { PaymentStatus, ShopOrder, ShopOrderStatus } from "./shop/orders";
import { isCompletedOrder } from "./shop/orders";

// Butikstabellerna finns inte i den plattformsgenererade Database-typen, så vi
// går via en otypad klient och typar resultaten själva (samma mönster som
// shop-orders.server.ts).
const admin = supabaseAdmin as unknown as SupabaseClient;

// Var kunden landar efter att ha klickat i inbjudningsmejlet. /login känner
// igen inbjudningstoken och visar "välj ditt lösenord".
const SET_PASSWORD_PATH = "/login";
const PRODUCTION_ORIGIN = "https://sipomax.se";

// Inbjudningslänken måste peka på den riktiga sajten. Klientens origin används
// bara när den ser ut som en produktionsvärd — localhost och förhandsvisningar
// avvisas så att inga mejl skickas med länkar till en utvecklingsmaskin.
function canonicalOrigin(origin?: string | null): string {
  const candidate = (origin || "").trim();
  if (candidate) {
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase();
      const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
      const isPreview =
        host.endsWith(".lovable.app") ||
        host.endsWith(".lovable.dev") ||
        host.endsWith(".lovableproject.com") ||
        host.endsWith(".netlify.app");
      if (!isLocal && !isPreview && (url.protocol === "https:" || url.protocol === "http:")) {
        return url.origin;
      }
    } catch {
      // Ogiltig URL — fall tillbaka på produktionsadressen.
    }
  }
  return PRODUCTION_ORIGIN;
}

type ProfileRow = {
  id: string;
  display_name: string | null;
  company_name: string | null;
  contact_phone: string | null;
  delivery_recipient: string | null;
  delivery_street: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  delivery_country: string | null;
  delivery_note: string | null;
  created_at: string | null;
};

const CUSTOMER_SELECT =
  "id, display_name, company_name, contact_phone, delivery_recipient, delivery_street, delivery_postal_code, delivery_city, delivery_country, delivery_note, created_at";

function rowToDetails(row: ProfileRow): ShopCustomerDetails {
  return {
    displayName: row.display_name,
    companyName: row.company_name,
    phone: row.contact_phone,
    deliveryRecipient: row.delivery_recipient,
    deliveryStreet: row.delivery_street,
    deliveryPostalCode: row.delivery_postal_code,
    deliveryCity: row.delivery_city,
    deliveryCountry: row.delivery_country,
    deliveryNote: row.delivery_note,
  };
}

type OrderStatsRow = {
  customer_user_id: string;
  total: number;
  status: ShopOrderStatus;
  payment_status: PaymentStatus;
  created_at: string;
};

type OrderStats = {
  orderCount: number;
  openOrderCount: number;
  totalSpent: number;
  outstanding: number;
  lastOrderAt: string | null;
};

const EMPTY_STATS: OrderStats = {
  orderCount: 0,
  openOrderCount: 0,
  totalSpent: 0,
  outstanding: 0,
  lastOrderAt: null,
};

function accumulate(stats: OrderStats, row: OrderStatsRow): OrderStats {
  const total = Number(row.total);
  const completed = isCompletedOrder({ status: row.status, paymentStatus: row.payment_status });
  return {
    orderCount: stats.orderCount + 1,
    openOrderCount: stats.openOrderCount + (completed ? 0 : 1),
    totalSpent: stats.totalSpent + total,
    outstanding:
      stats.outstanding +
      (row.payment_status === "obetald" || row.payment_status === "fakturerad" ? total : 0),
    lastOrderAt:
      !stats.lastOrderAt || row.created_at > stats.lastOrderAt ? row.created_at : stats.lastOrderAt,
  };
}

// E-postadresser bor i auth, inte i profiles. Auth saknar uppslag på id-lista,
// så vi sidhämtar användarlistan en gång och slår upp lokalt.
async function loadEmails(): Promise<Map<string, string | null>> {
  const emails = new Map<string, string | null>();
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  for (const user of data?.users ?? []) emails.set(user.id, user.email ?? null);
  return emails;
}

async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string; email: string | null } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const user = (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === target);
  return user ? { id: user.id, email: user.email ?? null } : null;
}

// Kunder som hör till verkstaden, plus alla som lagt en order hos den — även
// äldre konton som hann beställa innan kundregistret fanns.
async function customerIdsForWorkshop(workshopId: string): Promise<Set<string>> {
  const [{ data: linked, error: linkError }, { data: ordered, error: orderError }] =
    await Promise.all([
      admin.from("profiles").select("id").eq("customer_of_workshop_id", workshopId),
      admin.from("shop_orders").select("customer_user_id").eq("workshop_id", workshopId),
    ]);
  if (linkError) throw new Error(linkError.message);
  if (orderError) throw new Error(orderError.message);

  const ids = new Set<string>();
  for (const row of (linked ?? []) as Array<{ id: string }>) ids.add(row.id);
  for (const row of (ordered ?? []) as Array<{ customer_user_id: string }>) {
    ids.add(row.customer_user_id);
  }
  return ids;
}

export async function listShopCustomers(userId: string): Promise<ShopCustomerSummary[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const ids = [...(await customerIdsForWorkshop(workshopId))];
  if (ids.length === 0) return [];

  const [{ data: profiles, error }, { data: orders, error: orderError }, emails] =
    await Promise.all([
      admin.from("profiles").select(CUSTOMER_SELECT).in("id", ids),
      admin
        .from("shop_orders")
        .select("customer_user_id, total, status, payment_status, created_at")
        .eq("workshop_id", workshopId)
        .limit(5000),
      loadEmails(),
    ]);
  if (error) throw new Error(error.message);
  if (orderError) throw new Error(orderError.message);

  const statsById = new Map<string, OrderStats>();
  for (const row of (orders ?? []) as OrderStatsRow[]) {
    statsById.set(
      row.customer_user_id,
      accumulate(statsById.get(row.customer_user_id) ?? EMPTY_STATS, row),
    );
  }

  const pendingIds = await pendingInviteIds(ids);

  return ((profiles ?? []) as ProfileRow[])
    .map((row) => ({
      id: row.id,
      email: emails.get(row.id) ?? null,
      createdAt: row.created_at,
      pending: pendingIds.has(row.id),
      ...rowToDetails(row),
      ...(statsById.get(row.id) ?? EMPTY_STATS),
    }))
    .sort((a, b) => {
      // Kunder med aktivitet överst, därefter senast tillagda.
      const byOrder = (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? "");
      if (byOrder !== 0) return byOrder;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });
}

// Konton som aldrig loggat in har en obesvarad inbjudan.
async function pendingInviteIds(ids: string[]): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const wanted = new Set(ids);
  const pending = new Set<string>();
  for (const user of data?.users ?? []) {
    if (wanted.has(user.id) && !user.last_sign_in_at) pending.add(user.id);
  }
  return pending;
}

// Ordrarna på kundkortet hämtas med samma kolumner som verkstadens ordervy, så
// att korten kan visa artiklar, betalning och leverans utan extra anrop.
const CARD_ORDER_SELECT =
  "id, order_number, workshop_id, customer_user_id, customer_email, customer_name, customer_phone, status, total, note, payment_status, shipping_recipient, shipping_street, shipping_postal_code, shipping_city, shipping_country, carrier, tracking_number, internal_note, created_at, updated_at, shop_order_lines(product_id, name, unit, unit_price, quantity)";

type CardOrderRow = {
  id: string;
  order_number: number;
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
  shop_order_lines?: Array<{
    product_id: string;
    name: string;
    unit: string | null;
    unit_price: number;
    quantity: number;
  }>;
};

function cardRowToOrder(row: CardOrderRow): ShopOrder {
  return {
    id: row.id,
    orderNumber: Number(row.order_number),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    status: row.status,
    total: Number(row.total),
    customerUserId: row.customer_user_id,
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
    internalNote: row.internal_note ?? null,
    lines: (row.shop_order_lines ?? []).map((line) => ({
      productId: line.product_id,
      name: line.name,
      unit: line.unit,
      unitPrice: Number(line.unit_price),
      quantity: line.quantity,
    })),
  };
}

export async function getShopCustomer(
  userId: string,
  customerId: string,
): Promise<ShopCustomerCard> {
  const workshopId = await assertWorkshopAccount(userId);

  const [{ data: profile, error }, { data: orders, error: orderError }] = await Promise.all([
    admin.from("profiles").select(CUSTOMER_SELECT).eq("id", customerId).maybeSingle(),
    admin
      .from("shop_orders")
      .select(CARD_ORDER_SELECT)
      .eq("workshop_id", workshopId)
      .eq("customer_user_id", customerId)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  if (error) throw new Error(error.message);
  if (orderError) throw new Error(orderError.message);
  if (!profile) throw new Error("Kunden kunde inte hittas.");

  const row = profile as ProfileRow;
  const all = ((orders ?? []) as CardOrderRow[]).map(cardRowToOrder);

  // Kunden måste höra till verkstaden: antingen kopplad i registret eller
  // genom att ha lagt minst en order hos verkstaden.
  if (all.length === 0) {
    const { data: link } = await admin
      .from("profiles")
      .select("customer_of_workshop_id")
      .eq("id", customerId)
      .maybeSingle();
    if (
      (link as { customer_of_workshop_id: string | null } | null)?.customer_of_workshop_id !==
      workshopId
    ) {
      throw new Error("Kunden tillhör inte din verkstad.");
    }
  }

  const stats = ((orders ?? []) as CardOrderRow[]).reduce(
    (acc, order) =>
      accumulate(acc, {
        customer_user_id: customerId,
        total: order.total,
        status: order.status,
        payment_status: order.payment_status ?? "obetald",
        created_at: order.created_at,
      }),
    EMPTY_STATS,
  );

  const emails = await loadEmails();
  const pendingIds = await pendingInviteIds([customerId]);

  return {
    id: customerId,
    email: emails.get(customerId) ?? null,
    createdAt: row.created_at,
    pending: pendingIds.has(customerId),
    ...rowToDetails(row),
    ...stats,
    activeOrders: all.filter((order) => !isCompletedOrder(order)),
    completedOrders: all.filter((order) => isCompletedOrder(order)),
  };
}

/**
 * Databastriggern ger varje nytt konto rollen 'workshop', vilket är rätt för
 * medarbetare men fel för kunder — den rollen öppnar verkstadens egna tabeller
 * i RLS. Kundkonton ska bara nå butiken, så rollen tas bort direkt.
 */
async function stripWorkshopRole(userId: string): Promise<void> {
  const { error } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", "workshop");
  if (error) throw new Error(error.message);
}

function friendlyInviteError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") && lower.includes("registered")) {
    return "Det finns redan ett konto med den här e-postadressen.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "För många inbjudningar har skickats nyligen. Vänta en stund och försök igen.";
  }
  if (lower.includes("invalid") && lower.includes("email")) {
    return "Ogiltig e-postadress.";
  }
  return message;
}

export type InviteCustomerInput = {
  email: string;
  displayName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  origin?: string | null;
};

/**
 * Bjuder in en ny kund. Supabase skapar kontot och skickar bekräftelsemejlet
 * där kunden väljer sitt eget lösenord — vi sätter aldrig ett lösenord åt dem.
 */
export async function inviteShopCustomer(
  userId: string,
  input: InviteCustomerInput,
): Promise<{ id: string; email: string | null }> {
  const workshopId = await assertWorkshopAccount(userId);
  const email = input.email.trim().toLowerCase();
  const displayName = (input.displayName || "").trim();

  const existing = await findAuthUserByEmail(email);
  if (existing) {
    throw new Error("Det finns redan ett konto med den här e-postadressen.");
  }

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${canonicalOrigin(input.origin)}${SET_PASSWORD_PATH}`,
    data: displayName ? { display_name: displayName } : undefined,
  });
  if (error) throw new Error(friendlyInviteError(error.message));

  const newId = data.user?.id;
  if (!newId) throw new Error("Kontot kunde inte skapas.");

  // Kontot skapas som verkstadskonto av databastriggern — här görs det till en
  // kund kopplad till den här verkstaden.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      account_type: "customer",
      customer_of_workshop_id: workshopId,
      display_name: displayName || null,
      company_name: (input.companyName || "").trim() || null,
      contact_phone: (input.phone || "").trim() || null,
    })
    .eq("id", newId);
  if (profileError) throw new Error(profileError.message);
  await stripWorkshopRole(newId);

  return { id: newId, email: data.user?.email ?? email };
}

/**
 * Skickar inbjudningsmejlet igen till en kund som ännu inte aktiverat kontot.
 * Supabase vägrar bjuda in en adress som redan finns, så det obesvarade kontot
 * tas bort och skapas om med samma uppgifter. Bara konton som aldrig loggat in
 * går att bjuda in på nytt — ett aktivt konto får återställa lösenordet i
 * stället.
 */
export async function resendCustomerInvite(
  userId: string,
  customerId: string,
  origin?: string | null,
): Promise<{ id: string; email: string | null }> {
  const workshopId = await assertCustomerBelongsToWorkshop(userId, customerId);

  const { data: authUser, error: authError } =
    await supabaseAdmin.auth.admin.getUserById(customerId);
  if (authError) throw new Error(authError.message);
  const email = authUser.user?.email;
  if (!email) throw new Error("Kunden saknar e-postadress.");
  if (authUser.user?.last_sign_in_at) {
    throw new Error("Kunden har redan aktiverat sitt konto och kan återställa lösenordet själv.");
  }

  const { data: profile } = await admin
    .from("profiles")
    .select(CUSTOMER_SELECT)
    .eq("id", customerId)
    .maybeSingle();
  const details = profile ? rowToDetails(profile as ProfileRow) : null;

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(customerId);
  if (deleteError) throw new Error(deleteError.message);

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${canonicalOrigin(origin)}${SET_PASSWORD_PATH}`,
    data: details?.displayName ? { display_name: details.displayName } : undefined,
  });
  if (error) throw new Error(friendlyInviteError(error.message));
  const newId = data.user?.id;
  if (!newId) throw new Error("Inbjudan kunde inte skickas om.");

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      account_type: "customer",
      customer_of_workshop_id: workshopId,
      display_name: details?.displayName ?? null,
      company_name: details?.companyName ?? null,
      contact_phone: details?.phone ?? null,
      delivery_recipient: details?.deliveryRecipient ?? null,
      delivery_street: details?.deliveryStreet ?? null,
      delivery_postal_code: details?.deliveryPostalCode ?? null,
      delivery_city: details?.deliveryCity ?? null,
      delivery_country: details?.deliveryCountry ?? null,
      delivery_note: details?.deliveryNote ?? null,
    })
    .eq("id", newId);
  if (profileError) throw new Error(profileError.message);
  await stripWorkshopRole(newId);

  return { id: newId, email: data.user?.email ?? email };
}

async function assertCustomerBelongsToWorkshop(
  userId: string,
  customerId: string,
): Promise<string> {
  const workshopId = await assertWorkshopAccount(userId);
  const ids = await customerIdsForWorkshop(workshopId);
  if (!ids.has(customerId)) throw new Error("Kunden tillhör inte din verkstad.");
  return workshopId;
}

export type CustomerPatch = Partial<ShopCustomerDetails>;

/** Verkstaden uppdaterar kundens kontakt- och leveransuppgifter. */
export async function updateShopCustomer(
  userId: string,
  customerId: string,
  patch: CustomerPatch,
): Promise<void> {
  await assertCustomerBelongsToWorkshop(userId, customerId);

  const clean = (value: string | null | undefined) =>
    value === undefined ? undefined : value?.trim() || null;

  const update: Record<string, string | null> = {};
  const mapping: Array<[keyof ShopCustomerDetails, string]> = [
    ["displayName", "display_name"],
    ["companyName", "company_name"],
    ["phone", "contact_phone"],
    ["deliveryRecipient", "delivery_recipient"],
    ["deliveryStreet", "delivery_street"],
    ["deliveryPostalCode", "delivery_postal_code"],
    ["deliveryCity", "delivery_city"],
    ["deliveryCountry", "delivery_country"],
    ["deliveryNote", "delivery_note"],
  ];
  for (const [key, column] of mapping) {
    const value = clean(patch[key]);
    if (value !== undefined) update[column] = value;
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await admin.from("profiles").update(update).eq("id", customerId);
  if (error) throw new Error(error.message);
}
