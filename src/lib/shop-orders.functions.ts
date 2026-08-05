import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clearDeliveryDetails,
  createShopOrder,
  getAccountInfo,
  getDeliveryDetails,
  getOrderForCustomer,
  getWorkshopOrder,
  getWorkshopStats,
  listChatMessages,
  listChatThreads,
  listCustomerOrders,
  listOrderEvents,
  listOrderRefs,
  listWorkshopMembers,
  listWorkshopOrders,
  markThreadRead,
  saveDeliveryDetails,
  sendChatMessage,
  updateOrderInternalNote,
  updateOrderPaymentStatus,
  updateOrderShipping,
  updateShopOrderStatus,
} from "./shop-orders.server";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "./shop/orders";

// Kontotyp + utvecklarflagga för den inloggade användaren. Styr om appen
// visar kundbutiken eller verkstadsvyn efter inloggning.
export const getMyAccountInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getAccountInfo(context.userId);
  });

// ── Kund ────────────────────────────────────────────────────────────────────

const deliverySchema = z.object({
  recipient: z.string().trim().min(1).max(160),
  street: z.string().trim().min(1).max(200),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(120),
  country: z.string().trim().max(120).default("Sverige"),
  phone: z.string().trim().min(1).max(40),
  note: z.string().trim().max(500).default(""),
});

export const placeShopOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        items: z
          .array(
            z.object({
              productId: z.string().max(120),
              quantity: z.number().int().min(1).max(999),
            }),
          )
          .min(1)
          .max(100),
        delivery: deliverySchema,
        saveDetails: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return createShopOrder(context.userId, data.items, data.delivery, data.saveDetails);
  });

// Sparade leveransuppgifter på kundkortet — förifyller kassan.
export const getMyDeliveryDetailsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getDeliveryDetails(context.userId);
  });

export const saveMyDeliveryDetailsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => deliverySchema.parse(d))
  .handler(async ({ data, context }) => {
    await saveDeliveryDetails(context.userId, data);
    return { ok: true };
  });

export const clearMyDeliveryDetailsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await clearDeliveryDetails(context.userId);
    return { ok: true };
  });

export const listMyShopOrdersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return listCustomerOrders(context.userId);
  });

export const getMyShopOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return getOrderForCustomer(context.userId, data.orderId);
  });

// ── Verkstad ────────────────────────────────────────────────────────────────

export const listWorkshopOrdersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return listWorkshopOrders(context.userId);
  });

export const getWorkshopOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return getWorkshopOrder(context.userId, data.orderId);
  });

export const updateShopOrderStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        orderId: z.string().uuid(),
        status: z.enum(ORDER_STATUSES as [string, ...string[]]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Svaret bär med sig fakturan som skapades när ordern blev levererad, så
    // att verkstaden får veta det direkt i samma klick.
    const result = await updateShopOrderStatus(
      context.userId,
      data.orderId,
      data.status as (typeof ORDER_STATUSES)[number],
    );
    return { ok: true, ...result };
  });

export const updateOrderInternalNoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ orderId: z.string().uuid(), note: z.string().max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await updateOrderInternalNote(context.userId, data.orderId, data.note);
    return { ok: true };
  });

export const listOrderEventsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return listOrderEvents(context.userId, data.orderId);
  });

export const updateOrderPaymentStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        orderId: z.string().uuid(),
        paymentStatus: z.enum(PAYMENT_STATUSES as [string, ...string[]]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await updateOrderPaymentStatus(
      context.userId,
      data.orderId,
      data.paymentStatus as (typeof PAYMENT_STATUSES)[number],
    );
    return { ok: true };
  });

export const updateOrderShippingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        orderId: z.string().uuid(),
        recipient: z.string().max(160).nullable(),
        street: z.string().max(200).nullable(),
        postalCode: z.string().max(20).nullable(),
        city: z.string().max(120).nullable(),
        country: z.string().max(120).nullable(),
        carrier: z.string().max(60).nullable(),
        trackingNumber: z.string().max(120).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orderId, ...shipping } = data;
    await updateOrderShipping(context.userId, orderId, shipping);
    return { ok: true };
  });

export const listWorkshopMembersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return listWorkshopMembers(context.userId);
  });

export const searchOrderRefsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().max(80).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    return listOrderRefs(context.userId, data.query);
  });

export const getWorkshopStatsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getWorkshopStats(context.userId);
  });

// ── Chatt ───────────────────────────────────────────────────────────────────

export const listChatThreadsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return listChatThreads(context.userId);
  });

export const listChatMessagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    return listChatMessages(context.userId, data.orderId);
  });

export const markThreadReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await markThreadRead(context.userId, data.orderId);
    return { ok: true };
  });

export const sendChatMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        orderId: z.string().uuid().nullable(),
        body: z.string().trim().min(1).max(4000),
        mentions: z.array(z.string().uuid()).max(20).default([]),
        orderRefs: z.array(z.string().uuid()).max(20).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return sendChatMessage(context.userId, data.orderId, data.body, data.mentions, data.orderRefs);
  });
