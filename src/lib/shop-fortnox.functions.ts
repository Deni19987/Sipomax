import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAuthorizeUrl, disconnectFortnox, signState } from "./fortnox.server";
import {
  createInvoiceForShopOrder,
  getShopFortnoxStatus,
  getShopOrderInvoicePdf,
  importFortnoxArticles,
  syncShopOrderPayments,
  syncSingleOrderPayment,
} from "./shop-fortnox.server";
import { assertWorkshopAccount } from "./shop-orders.server";

// Butikens Fortnox-inställningar landar tillbaka i verkstadsappen, inte i den
// gamla CRM-vyn — sökvägen signeras med state så att callbacken inte kan
// omdirigeras någon annanstans.
const SHOP_RETURN_PATH = "/verkstad/installningar";

export const getShopFortnoxStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    return getShopFortnoxStatus(workshopId);
  });

export const getShopFortnoxAuthorizeUrlFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    const state = signState({ userId: workshopId, ts: Date.now(), returnTo: SHOP_RETURN_PATH });
    // Fortnox kräver exakt matchning mot den registrerade redirect-URI:n, så vi
    // använder alltid den publicerade adressen oavsett var klicket kom ifrån.
    const canonicalOrigin =
      process.env.CANONICAL_APP_URL?.replace(/\/$/, "") || "https://sipomax.se";
    return { url: buildAuthorizeUrl(state, `${canonicalOrigin}/api/public/fortnox/callback`) };
  });

export const disconnectShopFortnoxFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    await disconnectFortnox(workshopId);
    return { ok: true };
  });

/**
 * Den initiala importen av Fortnox-artiklar. Körs automatiskt första gången
 * inställningssidan öppnas efter att Fortnox anslutits, och är idempotent —
 * efterföljande anrop svarar bara "redan gjord".
 */
export const importFortnoxArticlesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    return importFortnoxArticles(workshopId);
  });

/** Stämmer av alla obetalda fakturor mot Fortnox. */
export const syncShopOrderPaymentsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    return syncShopOrderPayments(workshopId);
  });

/** Stämmer av en enskild orders faktura direkt. */
export const refreshOrderInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    return syncSingleOrderPayment(workshopId, data.orderId);
  });

/** Skapar fakturan manuellt när den automatiska körningen misslyckats. */
export const createOrderInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    const result = await createInvoiceForShopOrder(workshopId, data.orderId);
    if (!result.ok) throw new Error(result.error);
    return { invoiceId: result.invoiceId, alreadyExisted: result.alreadyExisted };
  });

/** Fakturans PDF för verkstaden. */
export const getWorkshopOrderInvoicePdfFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workshopId = await assertWorkshopAccount(context.userId);
    return getShopOrderInvoicePdf({ orderId: data.orderId, workshopId });
  });

/** Fakturans PDF för kunden — bara för kundens egna beställningar. */
export const getMyOrderInvoicePdfFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return getShopOrderInvoicePdf({ orderId: data.orderId, customerUserId: context.userId });
  });
