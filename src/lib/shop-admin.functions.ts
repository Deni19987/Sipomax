import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  deleteWorkshopCampaign,
  deleteWorkshopProduct,
  getCustomerShopExtras,
  listWorkshopCampaigns,
  listWorkshopProducts,
  saveWorkshopCampaign,
  saveWorkshopProduct,
} from "./shop-admin.server";

const productSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(80).optional().nullable(),
  category: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional().nullable(),
  price: z.number().min(0).max(1_000_000),
  unit: z.string().trim().max(40).optional().nullable(),
  status: z.enum(["draft", "published"]),
  imageBase64: z.string().max(8_000_000).optional().nullable(),
  imageType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional().nullable(),
});

export const listWorkshopProductsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return listWorkshopProducts(context.userId);
  });

export const saveWorkshopProductFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => productSchema.parse(d))
  .handler(async ({ data, context }) => {
    return saveWorkshopProduct(context.userId, data);
  });

export const deleteWorkshopProductFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await deleteWorkshopProduct(context.userId, data.id);
    return { ok: true };
  });

const campaignSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  template: z.enum(["free_shipping", "announcement", "product_promo"]),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  minOrder: z.number().min(0).max(1_000_000).optional().nullable(),
  active: z.boolean(),
});

export const listWorkshopCampaignsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return listWorkshopCampaigns(context.userId);
  });

export const saveWorkshopCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => campaignSchema.parse(d))
  .handler(async ({ data, context }) => {
    return saveWorkshopCampaign(context.userId, data);
  });

export const deleteWorkshopCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await deleteWorkshopCampaign(context.userId, data.id);
    return { ok: true };
  });

// Kundens butik: den egna verkstadens publicerade produkter + aktiva kampanjer.
export const getShopExtrasFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getCustomerShopExtras(context.userId);
  });
