// Fortnox i butiksflödet.
//
// Tre saker händer här:
//
//  1. **Initial artikelimport** — första gången en verkstad ansluter Fortnox
//     hämtas alla befintliga artiklar in som produkter i appen.
//  2. **Envägssynk av produkter** — efter importen skapas produkter bara i
//     appen och speglas till Fortnox. Artiklar som läggs upp direkt i Fortnox
//     hämtas aldrig in igen.
//  3. **Automatisk faktura** — när en order markeras som levererad skapas och
//     bokförs en faktura i Fortnox med orderns alla rader. När fakturan är
//     betald i Fortnox flyttas ordern vidare till "avklarad".

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  bookkeepFortnoxInvoice,
  createFortnoxArticle,
  createFortnoxCustomerDirect,
  createFortnoxInvoiceFromLines,
  fetchAllFortnoxArticles,
  fetchFortnoxInvoicePdfByNumber,
  getFortnoxConnection,
  getFortnoxInvoice,
  updateFortnoxArticle,
  type FortnoxInvoiceLineInput,
} from "./fortnox.server";
import { sendPushToUser, sendPushToWorkshop } from "./push.server";
import type { OrderInvoice, PaymentStatus, ShopOrderStatus } from "./shop/orders";

// Samma mönster som shop-orders.server.ts: butikstabellerna finns inte i den
// plattformsgenererade Database-typen, så vi går via en otypad klient.
const admin = supabaseAdmin as unknown as SupabaseClient;

// Momssats på butikens artiklar. Butiken säljer uteslutande varor med 25 %.
const SHOP_VAT = 25;

export type ShopInvoiceOrderRow = {
  id: string;
  order_number: number;
  workshop_id: string;
  customer_user_id: string;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: ShopOrderStatus;
  payment_status: PaymentStatus;
  shipping_recipient: string | null;
  shipping_street: string | null;
  shipping_postal_code: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  note: string | null;
  fortnox_invoice_id: string | null;
  fortnox_customer_number: string | null;
  invoice_paid_at: string | null;
};

const INVOICE_ORDER_SELECT =
  "id, order_number, workshop_id, customer_user_id, customer_email, customer_name, customer_phone, status, payment_status, shipping_recipient, shipping_street, shipping_postal_code, shipping_city, shipping_country, note, fortnox_invoice_id, fortnox_customer_number, invoice_paid_at";

/** Raderna på ordern, i den form som ska bli fakturarader. */
type OrderLineRow = {
  product_id: string;
  name: string;
  unit: string | null;
  unit_price: number;
  quantity: number;
};

export async function isFortnoxConnected(workshopId: string): Promise<boolean> {
  const conn = await getFortnoxConnection(workshopId);
  return !!conn;
}

// ── Orderns fakturauppgifter ────────────────────────────────────────────────

export type InvoiceColumns = {
  fortnox_invoice_id: string | null;
  invoice_created_at: string | null;
  invoice_due_date: string | null;
  invoice_total: number | string | null;
  invoice_balance: number | string | null;
  invoice_booked: boolean | null;
  invoice_paid_at: string | null;
};

/** De fakturakolumner både kundvyn och verkstadsvyn läser ut ur shop_orders. */
export const INVOICE_COLUMNS =
  "fortnox_invoice_id, invoice_created_at, invoice_due_date, invoice_total, invoice_balance, invoice_booked, invoice_paid_at";

export function rowToInvoice(row: Partial<InvoiceColumns> | null): OrderInvoice | null {
  const invoiceId = row?.fortnox_invoice_id?.trim();
  if (!invoiceId) return null;
  return {
    invoiceId,
    createdAt: row?.invoice_created_at ?? null,
    dueDate: row?.invoice_due_date ?? null,
    total: row?.invoice_total != null ? Number(row.invoice_total) : null,
    balance: row?.invoice_balance != null ? Number(row.invoice_balance) : null,
    booked: !!row?.invoice_booked,
    paidAt: row?.invoice_paid_at ?? null,
  };
}

// ── 1) Initial import av Fortnox-artiklar → appens produkter ────────────────

export type ArticleImportResult = {
  imported: number;
  skipped: number;
  alreadyDone: boolean;
  importedAt: string | null;
};

async function getArticleImportStamp(workshopId: string): Promise<string | null> {
  const { data } = await admin
    .from("fortnox_cache_meta")
    .select("synced_at")
    .eq("workshop_id", workshopId)
    .eq("kind", "shop_article_import")
    .maybeSingle();
  return (data?.synced_at as string | null) ?? null;
}

async function setArticleImportStamp(workshopId: string): Promise<void> {
  const { error } = await admin
    .from("fortnox_cache_meta")
    .upsert(
      { workshop_id: workshopId, kind: "shop_article_import", synced_at: new Date().toISOString() },
      { onConflict: "workshop_id,kind" },
    );
  if (error) throw new Error(error.message);
}

/**
 * Hämtar hela Fortnox-artikelregistret och lägger upp det som produkter i
 * appen. Körs **en gång** per verkstad, direkt efter att Fortnox anslutits —
 * därefter är synken enkelriktad åt andra hållet.
 *
 * Importerade produkter blir utkast (status 'draft') så att verkstaden själv
 * väljer vad som ska synas i kundbutiken.
 */
export async function importFortnoxArticles(
  workshopId: string,
  options: { force?: boolean } = {},
): Promise<ArticleImportResult> {
  const existingStamp = await getArticleImportStamp(workshopId);
  if (existingStamp && !options.force) {
    return { imported: 0, skipped: 0, alreadyDone: true, importedAt: existingStamp };
  }
  if (!(await isFortnoxConnected(workshopId))) {
    throw new Error("Fortnox är inte anslutet.");
  }

  const articles = await fetchAllFortnoxArticles(workshopId);

  // Produkter som redan är kopplade till en artikel hoppas över, så att en
  // omkörning aldrig skapar dubbletter.
  const { data: existing, error: existingError } = await admin
    .from("workshop_products")
    .select("fortnox_article_number")
    .eq("workshop_id", workshopId)
    .not("fortnox_article_number", "is", null);
  if (existingError) throw new Error(existingError.message);
  const known = new Set(
    ((existing ?? []) as Array<{ fortnox_article_number: string }>).map(
      (r) => r.fortnox_article_number,
    ),
  );

  const rows = articles
    .filter((a) => a.articleNumber && !known.has(a.articleNumber))
    .map((a) => ({
      workshop_id: workshopId,
      name: (a.description || a.articleNumber).slice(0, 160),
      brand: null,
      category: "tillbehor",
      description: null,
      price: a.salesPrice ?? 0,
      unit: a.unit,
      status: "draft",
      source: "fortnox",
      fortnox_article_number: a.articleNumber,
      fortnox_synced_at: new Date().toISOString(),
    }));

  // Insert i block så att ett stort artikelregister inte blir en enda jätterad.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.from("workshop_products").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }

  await setArticleImportStamp(workshopId);
  return {
    imported: rows.length,
    skipped: articles.length - rows.length,
    alreadyDone: false,
    importedAt: new Date().toISOString(),
  };
}

export async function getShopFortnoxStatus(workshopId: string): Promise<{
  connected: boolean;
  articleImportAt: string | null;
  productCount: number;
  syncedProductCount: number;
  failedProductCount: number;
}> {
  const [conn, importAt, { count: productCount }, { count: syncedCount }, { count: failedCount }] =
    await Promise.all([
      getFortnoxConnection(workshopId),
      getArticleImportStamp(workshopId),
      admin
        .from("workshop_products")
        .select("id", { count: "exact", head: true })
        .eq("workshop_id", workshopId),
      admin
        .from("workshop_products")
        .select("id", { count: "exact", head: true })
        .eq("workshop_id", workshopId)
        .not("fortnox_article_number", "is", null),
      admin
        .from("workshop_products")
        .select("id", { count: "exact", head: true })
        .eq("workshop_id", workshopId)
        .not("fortnox_sync_error", "is", null),
    ]);

  return {
    connected: !!conn,
    articleImportAt: importAt,
    productCount: productCount ?? 0,
    syncedProductCount: syncedCount ?? 0,
    failedProductCount: failedCount ?? 0,
  };
}

// ── 2) Envägssynk: appens produkter → Fortnox-artiklar ──────────────────────

/**
 * Speglar en produkt till Fortnox. Nya produkter blir nya artiklar, ändrade
 * produkter uppdaterar sin artikel. Synken är alltid best-effort: ett fel i
 * Fortnox får aldrig hindra verkstaden från att spara sin produkt — felet
 * sparas på raden och visas i produktvyn i stället.
 */
export async function syncProductToFortnox(
  workshopId: string,
  product: {
    id: string;
    name: string;
    price: number;
    unit: string | null;
    fortnoxArticleNumber: string | null;
  },
): Promise<{ articleNumber: string | null; error: string | null }> {
  if (!(await isFortnoxConnected(workshopId))) {
    return { articleNumber: product.fortnoxArticleNumber, error: null };
  }

  try {
    let articleNumber = product.fortnoxArticleNumber?.trim() || null;
    if (articleNumber) {
      const updated = await updateFortnoxArticle(workshopId, articleNumber, {
        description: product.name,
        salesPrice: product.price,
        unit: product.unit ?? undefined,
        vat: SHOP_VAT,
      });
      articleNumber = updated.articleNumber;
    } else {
      // Utan artikelnummer sätter Fortnox nästa lediga nummer själv.
      const created = await createFortnoxArticle(workshopId, {
        description: product.name,
        salesPrice: product.price,
        unit: product.unit ?? undefined,
        vat: SHOP_VAT,
      });
      articleNumber = created.articleNumber;
      // SalesPrice är skrivskyddad vid POST — sätts i en efterföljande PUT.
      await updateFortnoxArticle(workshopId, articleNumber, {
        description: product.name,
        salesPrice: product.price,
        unit: product.unit ?? undefined,
        vat: SHOP_VAT,
      });
    }

    await admin
      .from("workshop_products")
      .update({
        fortnox_article_number: articleNumber,
        fortnox_synced_at: new Date().toISOString(),
        fortnox_sync_error: null,
      })
      .eq("id", product.id)
      .eq("workshop_id", workshopId);

    return { articleNumber, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    console.error("[shop-fortnox] product sync failed", product.id, message);
    try {
      await admin
        .from("workshop_products")
        .update({ fortnox_sync_error: message.slice(0, 500) })
        .eq("id", product.id)
        .eq("workshop_id", workshopId);
    } catch {
      /* felmeddelandet är sekundärt — produkten är redan sparad */
    }
    return { articleNumber: product.fortnoxArticleNumber, error: message };
  }
}

// ── 3) Automatisk faktura när ordern levererats ─────────────────────────────

async function logInvoiceEvent(
  order: ShopInvoiceOrderRow,
  type: "invoice_created" | "invoice_failed" | "invoice_paid",
  detail: string | null,
): Promise<void> {
  const { error } = await admin.from("shop_order_events").insert({
    order_id: order.id,
    workshop_id: order.workshop_id,
    actor_id: null,
    actor_name: "Fortnox",
    type,
    detail: detail?.slice(0, 500) ?? null,
  });
  if (error) console.error("[shop-fortnox] could not log event", type, error.message);
}

/**
 * Kundnumret i Fortnox för orderns kund. Sparas på ordern så att nästa order
 * från samma kund hamnar på samma kundkort i Fortnox.
 */
async function resolveFortnoxCustomerNumber(order: ShopInvoiceOrderRow): Promise<string> {
  if (order.fortnox_customer_number?.trim()) return order.fortnox_customer_number.trim();

  // Har kunden fakturerats tidigare återanvänds kundnumret från den ordern.
  const { data: earlier } = await admin
    .from("shop_orders")
    .select("fortnox_customer_number")
    .eq("workshop_id", order.workshop_id)
    .eq("customer_user_id", order.customer_user_id)
    .not("fortnox_customer_number", "is", null)
    .limit(1)
    .maybeSingle();
  const reused = (earlier?.fortnox_customer_number as string | null)?.trim();
  if (reused) return reused;

  const name =
    order.shipping_recipient?.trim() ||
    order.customer_name?.trim() ||
    order.customer_email?.trim() ||
    `Kund ${order.order_number}`;

  const { customerNumber } = await createFortnoxCustomerDirect(order.workshop_id, {
    name,
    email: order.customer_email ?? undefined,
    phone: order.customer_phone ?? undefined,
    address: order.shipping_street ?? undefined,
    zipCode: order.shipping_postal_code ?? undefined,
    city: order.shipping_city ?? undefined,
  });
  return customerNumber;
}

/** Orderns rader som fakturarader, med artikelnummer där produkten är synkad. */
async function buildInvoiceLines(order: ShopInvoiceOrderRow): Promise<FortnoxInvoiceLineInput[]> {
  const { data: lines, error } = await admin
    .from("shop_order_lines")
    .select("product_id, name, unit, unit_price, quantity")
    .eq("order_id", order.id);
  if (error) throw new Error(error.message);
  const rows = (lines ?? []) as OrderLineRow[];
  if (rows.length === 0) throw new Error("Ordern saknar rader att fakturera.");

  // Produkterna i appen bär Fortnox-artikelnumret. Saknas det (produkten är
  // aldrig synkad, eller raden kommer från den statiska katalogen) faktureras
  // raden som fritext med samma pris — fakturan blir alltid komplett.
  const productIds = rows.map((r) => r.product_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const articleByProduct = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await admin
      .from("workshop_products")
      .select("id, fortnox_article_number")
      .eq("workshop_id", order.workshop_id)
      .in("id", productIds);
    for (const p of (products ?? []) as Array<{
      id: string;
      fortnox_article_number: string | null;
    }>) {
      if (p.fortnox_article_number) articleByProduct.set(p.id, p.fortnox_article_number);
    }
  }

  return rows.map((row) => ({
    articleNumber: articleByProduct.get(row.product_id) ?? null,
    description: row.name,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    unit: row.unit,
    vat: SHOP_VAT,
  }));
}

async function loadInvoiceOrder(workshopId: string, orderId: string): Promise<ShopInvoiceOrderRow> {
  const { data, error } = await admin
    .from("shop_orders")
    .select(INVOICE_ORDER_SELECT)
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Beställningen kunde inte hittas.");
  return data as ShopInvoiceOrderRow;
}

export type InvoiceCreationResult =
  | { ok: true; invoiceId: string; alreadyExisted: boolean }
  | { ok: false; error: string };

/**
 * Skapar (och bokför) fakturan för en order i Fortnox. Anropas automatiskt när
 * ordern markeras som levererad, och manuellt från ordervyn om något gick fel.
 *
 * En order faktureras aldrig två gånger: finns redan ett fakturanummer på
 * raden returneras det oförändrat.
 */
export async function createInvoiceForShopOrder(
  workshopId: string,
  orderId: string,
): Promise<InvoiceCreationResult> {
  const order = await loadInvoiceOrder(workshopId, orderId);
  if (order.fortnox_invoice_id?.trim()) {
    return { ok: true, invoiceId: order.fortnox_invoice_id.trim(), alreadyExisted: true };
  }
  if (!(await isFortnoxConnected(workshopId))) {
    return { ok: false, error: "Fortnox är inte anslutet — ingen faktura skapades." };
  }

  try {
    const [customerNumber, lines] = await Promise.all([
      resolveFortnoxCustomerNumber(order),
      buildInvoiceLines(order),
    ]);

    const { invoiceId, invoice } = await createFortnoxInvoiceFromLines(workshopId, {
      customerNumber,
      lines,
      emailTo: order.customer_email,
      ourReference: `Order ${order.order_number}`,
      yourReference: order.customer_name ?? undefined,
      externalReference: `SIPOMAX-${order.order_number}`,
      remarks: order.note ?? undefined,
      delivery: {
        name: order.shipping_recipient,
        address: order.shipping_street,
        zipCode: order.shipping_postal_code,
        city: order.shipping_city,
        country: order.shipping_country,
      },
    });

    // Bokföringen gör fakturan till en riktig, betalbar faktura i Fortnox —
    // utan den går den inte att markera som betald, och då skulle ordern
    // aldrig kunna bli avklarad. Misslyckas den (t.ex. låst räkenskapsår)
    // behåller vi ändå fakturan och låter verkstaden bokföra själv.
    let booked = false;
    try {
      await bookkeepFortnoxInvoice(workshopId, invoiceId);
      booked = true;
    } catch (err) {
      console.error(
        "[shop-fortnox] bookkeeping failed",
        invoiceId,
        err instanceof Error ? err.message : err,
      );
    }

    await admin
      .from("shop_orders")
      .update({
        fortnox_invoice_id: invoiceId,
        fortnox_customer_number: customerNumber,
        invoice_created_at: new Date().toISOString(),
        invoice_due_date: invoice?.DueDate ?? null,
        invoice_total: invoice?.Total != null ? Number(invoice.Total) : null,
        invoice_balance: invoice?.Balance != null ? Number(invoice.Balance) : null,
        invoice_booked: booked,
        invoice_checked_at: new Date().toISOString(),
        invoice_error: null,
        payment_status: "fakturerad",
      })
      .eq("id", order.id)
      .eq("workshop_id", workshopId);

    await logInvoiceEvent(order, "invoice_created", `#${invoiceId}`);

    try {
      await sendPushToUser(order.customer_user_id, {
        title: `Faktura för order #${order.order_number}`,
        body: "Din beställning är levererad. Fakturan finns nu i appen.",
        url: `/bestallningar/${order.id}`,
        tag: `invoice-${order.id}`,
      });
    } catch (err) {
      console.error("[shop-fortnox] invoice push failed", err);
    }

    return { ok: true, invoiceId, alreadyExisted: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    console.error("[shop-fortnox] invoice creation failed", orderId, message);
    await admin
      .from("shop_orders")
      .update({ invoice_error: message.slice(0, 500) })
      .eq("id", order.id)
      .eq("workshop_id", workshopId);
    await logInvoiceEvent(order, "invoice_failed", message);
    try {
      await sendPushToWorkshop(workshopId, {
        title: `Fakturan för order #${order.order_number} misslyckades`,
        body: message.slice(0, 140),
        url: `/verkstad?order=${order.id}`,
        tag: `invoice-error-${order.id}`,
      });
    } catch {
      /* notisen är sekundär */
    }
    return { ok: false, error: message };
  }
}

// ── 4) Betald faktura i Fortnox → ordern blir avklarad ──────────────────────

/** Fakturan som Fortnox svarar med — bara de fält vi faktiskt läser. */
type FortnoxInvoiceShape = {
  Cancelled?: unknown;
  Booked?: unknown;
  FinalPayDate?: string | null;
  Balance?: number | string | null;
  Total?: number | string | null;
  DueDate?: string | null;
};

function invoiceIsPaid(invoice: FortnoxInvoiceShape | null): boolean {
  if (!invoice) return false;
  if (asBool(invoice.Cancelled)) return false;
  // Fortnox sätter FinalPayDate när fakturan är slutbetald. Balance = 0 på en
  // bokförd faktura betyder samma sak, och täcker delbetalningar som tillsammans
  // gör fakturan helbetald.
  if (invoice.FinalPayDate) return true;
  const balance = invoice.Balance != null ? Number(invoice.Balance) : null;
  return asBool(invoice.Booked) && balance != null && Math.abs(balance) < 0.01;
}

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return Boolean(v);
}

/** Läser en fakturas status i Fortnox och speglar den till ordern. */
async function refreshOrderInvoiceState(order: ShopInvoiceOrderRow): Promise<boolean> {
  const invoiceId = order.fortnox_invoice_id?.trim();
  if (!invoiceId) return false;

  const invoice = (await getFortnoxInvoice(
    order.workshop_id,
    invoiceId,
  )) as FortnoxInvoiceShape | null;
  if (!invoice) return false;

  const paid = invoiceIsPaid(invoice);
  const wasPaid = !!order.invoice_paid_at;
  const paidAt = paid ? (order.invoice_paid_at ?? new Date().toISOString()) : null;

  const patch: Record<string, unknown> = {
    invoice_total: invoice.Total != null ? Number(invoice.Total) : null,
    invoice_balance: invoice.Balance != null ? Number(invoice.Balance) : null,
    invoice_due_date: invoice.DueDate ?? null,
    invoice_booked: asBool(invoice.Booked),
    invoice_checked_at: new Date().toISOString(),
    invoice_paid_at: paidAt,
  };

  // Betald faktura avslutar ordern: den lämnar "levererad" och hamnar som
  // avklarad på kundkortet.
  if (paid && !wasPaid) {
    patch.payment_status = "betald";
    if (order.status === "levererad") {
      patch.status = "avklarad";
      patch.completed_at = new Date().toISOString();
    }
  }

  const { error } = await admin
    .from("shop_orders")
    .update(patch)
    .eq("id", order.id)
    .eq("workshop_id", order.workshop_id);
  if (error) throw new Error(error.message);

  if (paid && !wasPaid) {
    await logInvoiceEvent(order, "invoice_paid", `#${invoiceId}`);
    try {
      await sendPushToWorkshop(order.workshop_id, {
        title: `Order #${order.order_number} är avklarad`,
        body: `Faktura #${invoiceId} är betald i Fortnox.`,
        url: `/verkstad?order=${order.id}`,
        tag: `invoice-paid-${order.id}`,
      });
    } catch (err) {
      console.error("[shop-fortnox] paid push failed", err);
    }
    return true;
  }
  return false;
}

// Varje order kostar ett anrop mot Fortnox, så en körning tar bara en bit i
// taget. Den som väntat längst på en kontroll går först, vilket gör att alla
// obetalda fakturor stäms av över några körningar utan att någon enskild
// begäran blir långsam.
const PAYMENT_SYNC_BATCH = 15;

/**
 * Stämmer av fakturerade ordrar mot Fortnox. Körs både från verkstadsvyn
 * (medan någon tittar på ordrarna) och från det schemalagda anropet.
 */
export async function syncShopOrderPayments(workshopId: string): Promise<{
  checked: number;
  completed: number;
}> {
  if (!(await isFortnoxConnected(workshopId))) return { checked: 0, completed: 0 };

  const { data, error } = await admin
    .from("shop_orders")
    .select(INVOICE_ORDER_SELECT)
    .eq("workshop_id", workshopId)
    .not("fortnox_invoice_id", "is", null)
    .is("invoice_paid_at", null)
    .order("invoice_checked_at", { ascending: true, nullsFirst: true })
    .limit(PAYMENT_SYNC_BATCH);
  if (error) throw new Error(error.message);

  const orders = (data ?? []) as ShopInvoiceOrderRow[];
  let completed = 0;
  for (const order of orders) {
    try {
      if (await refreshOrderInvoiceState(order)) completed += 1;
    } catch (err) {
      console.error(
        "[shop-fortnox] payment check failed",
        order.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { checked: orders.length, completed };
}

/** Stämmer av en enskild order direkt (knappen "Uppdatera från Fortnox"). */
export async function syncSingleOrderPayment(
  workshopId: string,
  orderId: string,
): Promise<{ paid: boolean }> {
  const order = await loadInvoiceOrder(workshopId, orderId);
  if (!order.fortnox_invoice_id) return { paid: false };
  await refreshOrderInvoiceState(order);
  const { data } = await admin
    .from("shop_orders")
    .select("invoice_paid_at")
    .eq("id", orderId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  return { paid: !!data?.invoice_paid_at };
}

/** Alla verkstäder med en Fortnox-anslutning — underlag för det schemalagda jobbet. */
export async function listFortnoxWorkshopIds(): Promise<string[]> {
  const { data, error } = await admin.from("fortnox_connections").select("user_id").limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}

// ── Fakturans PDF ───────────────────────────────────────────────────────────

/**
 * Fakturans PDF som base64. `customerUserId` sätts när kunden själv hämtar
 * fakturan — då måste ordern tillhöra hen.
 */
export async function getShopOrderInvoicePdf(input: {
  orderId: string;
  workshopId?: string;
  customerUserId?: string;
}): Promise<{ invoiceId: string; orderNumber: number; pdfBase64: string }> {
  let query = admin
    .from("shop_orders")
    .select("id, order_number, workshop_id, customer_user_id, fortnox_invoice_id")
    .eq("id", input.orderId);
  if (input.workshopId) query = query.eq("workshop_id", input.workshopId);
  if (input.customerUserId) query = query.eq("customer_user_id", input.customerUserId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Beställningen kunde inte hittas.");

  const order = data as {
    order_number: number;
    workshop_id: string;
    fortnox_invoice_id: string | null;
  };
  const invoiceId = order.fortnox_invoice_id?.trim();
  if (!invoiceId) throw new Error("Ingen faktura är skapad för den här beställningen ännu.");

  const pdfBase64 = await fetchFortnoxInvoicePdfByNumber(order.workshop_id, invoiceId);
  return { invoiceId, orderNumber: Number(order.order_number), pdfBase64 };
}
