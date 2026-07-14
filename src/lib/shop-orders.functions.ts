import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createShopOrder,
  getAccountInfo,
  getOrderForCustomer,
  getWorkshopOrder,
  getWorkshopStats,
  listChatMessages,
  listChatThreads,
  listCustomerOrders,
  listWorkshopOrders,
  sendChatMessage,
  updateShopOrderStatus,
} from "./shop-orders.server";
import { ORDER_STATUSES } from "./shop/orders";

// Kontotyp + utvecklarflagga för den inloggade användaren. Styr om appen
// visar kundbutiken eller verkstadsvyn efter inloggning.
export const getMyAccountInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getAccountInfo(context.userId);
  });

// ── Kund ────────────────────────────────────────────────────────────────────

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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return createShopOrder(context.userId, data.items);
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
    await updateShopOrderStatus(
      context.userId,
      data.orderId,
      data.status as (typeof ORDER_STATUSES)[number],
    );
    return { ok: true };
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

export const sendChatMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        orderId: z.string().uuid().nullable(),
        body: z.string().trim().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return sendChatMessage(context.userId, data.orderId, data.body);
  });
