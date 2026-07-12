import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getWorkshopProfile,
  updateWorkshopProfile,
  isDeveloperUser,
  getUserFeatureFlags,
  listAllAuthUsers,
  generateImpersonationOtp,
} from "./profile.server";
import { isAdminUser } from "./users.server";
import {
  OPPORTUNITIES_BASE_PROMPT,
  SERVICE_CAMPAIGN_BASE_PROMPT,
  SERVICE_METRICS,
  DEFAULT_SERVICE_METRIC_KEYS,
} from "./ai-prompts";

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const profile = await getWorkshopProfile(context.userId);
    return { profile };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        display_name: z.string().max(120).optional().nullable(),
        company_name: z.string().max(160).optional().nullable(),
        company_zip_code: z.string().max(20).optional().nullable(),
        company_city: z.string().max(100).optional().nullable(),
        company_org_number: z.string().max(30).optional().nullable(),
        company_vat_number: z.string().max(30).optional().nullable(),
        contact_email: z.string().email().max(160).optional().nullable().or(z.literal("")),
        contact_phone: z.string().max(40).optional().nullable(),
        workshop_address: z.string().max(400).optional().nullable(),
        google_review_url: z.string().url().max(500).optional().nullable().or(z.literal("")),
        pickup_sms_enabled: z.boolean().optional(),
        pickup_sms_review_enabled: z.boolean().optional(),
        pickup_sms_review_message: z.string().max(1000).optional().nullable(),
        sms_signature: z.string().max(200).optional().nullable(),
        opportunity_prompt_extra: z.string().max(4000).optional().nullable(),
        service_prompt_extra: z.string().max(4000).optional().nullable(),
        service_metrics: z.array(z.string().max(80)).max(50).optional().nullable(),
        opportunity_prompt_base: z.string().max(20000).optional().nullable(),
        service_prompt_base: z.string().max(20000).optional().nullable(),
        notify_customer_messages: z.boolean().optional(),
        notify_quote_responses: z.boolean().optional(),
        notify_pending_reminders: z.boolean().optional(),
        notify_mobile_push: z.boolean().optional(),
        notify_desktop_push: z.boolean().optional(),
        opportunities_enabled: z.boolean().optional(),
        campaigns_enabled: z.boolean().optional(),
        invoice_bank_details: z
          .object({
            bankgiro: z.string().max(20).optional().nullable(),
            plusgiro: z.string().max(20).optional().nullable(),
            iban: z.string().max(50).optional().nullable(),
            clearingNumber: z.string().max(10).optional().nullable(),
            accountNumber: z.string().max(20).optional().nullable(),
            paymentNote: z.string().max(200).optional().nullable(),
          })
          .optional()
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (typeof v === "string") {
        cleaned[k] = v.trim() === "" ? null : v.trim();
      } else {
        cleaned[k] = v;
      }
    }
    // Per-user feature flags are admin-only. Strip them for non-admins so a
    // regular user can't change their own page access via this endpoint.
    if ("opportunities_enabled" in cleaned || "campaigns_enabled" in cleaned) {
      if (!(await isAdminUser(context.userId))) {
        delete cleaned.opportunities_enabled;
        delete cleaned.campaigns_enabled;
      }
    }
    const profile = await updateWorkshopProfile(context.userId, cleaned);
    return { profile };
  });

// Lightweight read of the current user's feature flags. Used by the insights
// buttons and the opportunities/campaigns route guards to adapt the UI per
// account.
export const getMyFeatureFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getUserFeatureFlags(context.userId);
  });

export const getAiPromptSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isDeveloper = await isDeveloperUser(context.userId);
    return {
      isDeveloper,
      opportunitiesBasePrompt: isDeveloper ? OPPORTUNITIES_BASE_PROMPT : null,
      serviceBasePrompt: isDeveloper ? SERVICE_CAMPAIGN_BASE_PROMPT : null,
      serviceMetrics: SERVICE_METRICS,
      defaultServiceMetricKeys: DEFAULT_SERVICE_METRIC_KEYS,
    };
  });

export const getNewInsightsCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("insights_last_seen_at")
      .eq("id", userId)
      .maybeSingle();
    const since = prof?.insights_last_seen_at ?? new Date(0).toISOString();

    const [oppRes, campRes] = await Promise.all([
      supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .gt("created_at", since),
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .gt("created_at", since),
    ]);

    const newOpportunities = oppRes.count ?? 0;
    const newCampaigns = campRes.count ?? 0;
    return { newOpportunities, newCampaigns, total: newOpportunities + newCampaigns };
  });

export const markInsightsSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({ insights_last_seen_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Developer-only: generate a Supabase magic link to truly sign in as another user.
export const generateImpersonationOtpFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ email: z.string().email().max(160) }).parse(d))
  .handler(async ({ data, context }) => {
    return generateImpersonationOtp(context.userId, data.email);
  });

// Developer-only: check if caller is a developer and fetch all users for account switcher.
export const getImpersonationStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isDev = await isDeveloperUser(context.userId);
    if (!isDev) return { isDeveloper: false, allUsers: [] as Array<{ id: string; email: string }> };
    // Clear any stale impersonating_workshop_id left from the old implementation
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("profiles")
      .update({ impersonating_workshop_id: null } as any)
      .eq("id", context.userId)
      .not("impersonating_workshop_id", "is", null);
    const allUsers = await listAllAuthUsers();
    return { isDeveloper: true, allUsers };
  });