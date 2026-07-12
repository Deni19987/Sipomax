import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  listCampaigns,
  generateServiceDueCampaigns,
  updateCampaign,
  approveCampaign,
  dismissCampaign,
  rewriteCampaignMessage,
} from "./campaigns.server";

const RecipientSchema = z.object({
  job_id: z.string().uuid().nullable(),
  customer_name: z.string().min(1).max(200),
  customer_first_name: z.string().max(200).optional().transform((v) => v ?? ""),
  customer_phone: z.string().max(40).nullable(),
  registration_number: z.string().max(20).nullable(),
  predicted_service_due_date: z.string().max(40).nullable(),
  predicted_reason: z.string().max(300).nullable(),
});

export const listCamps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const items = await listCampaigns(context.userId);
    return { items };
  });

export const generateCamps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => generateServiceDueCampaigns(context.userId));

export const updateCamp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      suggested_message: z.string().min(1).max(1000).optional(),
      suggested_send_at: z.string().datetime({ offset: true }).optional(),
      recipients: z.array(RecipientSchema).max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const item = await updateCampaign(context.userId, id, patch);
    return { item };
  });

export const approveCamp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const item = await approveCampaign(context.userId, data.id);
    return { item };
  });

export const dismissCamp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => dismissCampaign(context.userId, data.id));

export const rewriteCampMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      instructions: z.string().max(500).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const item = await rewriteCampaignMessage(context.userId, data.id, data.instructions ?? null);
    return { item };
  });