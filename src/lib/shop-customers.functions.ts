import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getShopCustomer,
  inviteShopCustomer,
  listShopCustomers,
  resendCustomerInvite,
  updateShopCustomer,
} from "./shop-customers.server";

export const listShopCustomersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return listShopCustomers(context.userId);
  });

export const getShopCustomerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ customerId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return getShopCustomer(context.userId, data.customerId);
  });

export const inviteShopCustomerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email().max(160),
        displayName: z.string().max(120).optional().nullable(),
        companyName: z.string().max(160).optional().nullable(),
        phone: z.string().max(40).optional().nullable(),
        origin: z.string().max(300).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const customer = await inviteShopCustomer(context.userId, data);
    return { ok: true, customer };
  });

export const resendCustomerInviteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        customerId: z.string().uuid(),
        origin: z.string().max(300).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const customer = await resendCustomerInvite(context.userId, data.customerId, data.origin);
    return { ok: true, customer };
  });

export const updateShopCustomerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        customerId: z.string().uuid(),
        patch: z.object({
          displayName: z.string().max(120).nullable().optional(),
          companyName: z.string().max(160).nullable().optional(),
          phone: z.string().max(40).nullable().optional(),
          deliveryRecipient: z.string().max(160).nullable().optional(),
          deliveryStreet: z.string().max(200).nullable().optional(),
          deliveryPostalCode: z.string().max(20).nullable().optional(),
          deliveryCity: z.string().max(120).nullable().optional(),
          deliveryCountry: z.string().max(120).nullable().optional(),
          deliveryNote: z.string().max(500).nullable().optional(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await updateShopCustomer(context.userId, data.customerId, data.patch);
    return { ok: true };
  });
