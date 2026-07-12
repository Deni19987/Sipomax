import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  listOpportunities,
  generateOpportunities,
  updateOpportunity,
  approveOpportunity,
  dismissOpportunity,
  rewriteOpportunityMessage,
} from "./opportunities.server";

export const listOpps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const items = await listOpportunities(context.userId);
    return { items };
  });

export const generateOpps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return generateOpportunities(context.userId);
  });

export const updateOpp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      suggested_message: z.string().min(1).max(1000).optional(),
      suggested_send_at: z.string().datetime({ offset: true }).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const item = await updateOpportunity(context.userId, id, patch);
    return { item };
  });

export const approveOpp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const item = await approveOpportunity(context.userId, data.id);
    return { item };
  });

export const dismissOpp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return dismissOpportunity(context.userId, data.id);
  });

export const rewriteOppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      instructions: z.string().max(500).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const item = await rewriteOpportunityMessage(context.userId, data.id, data.instructions ?? null);
    return { item };
  });