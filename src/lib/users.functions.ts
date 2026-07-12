import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertAdmin,
  adminUploadUserInvoiceLogo,
  deleteWorkshopUser,
  getManagedUserSettings,
  inviteWorkshopUser,
  isAdminUser,
  listManagedUsers,
  updateManagedUserSettings,
} from "./users.server";

// Editable settings an admin may change on another user's behalf. Mirrors
// updateProfile but adds the per-user flags and omits integrations / base prompts.
const managedSettingsSchema = z.object({
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
  notify_customer_messages: z.boolean().optional(),
  notify_quote_responses: z.boolean().optional(),
  notify_pending_reminders: z.boolean().optional(),
  opportunities_enabled: z.boolean().optional(),
  campaigns_enabled: z.boolean().optional(),
  invoice_logo_url: z.string().url().max(500).optional().nullable().or(z.literal("")),
  invoice_accent_color: z.string().max(20).optional().nullable(),
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
});

// Returns whether the caller may manage users, plus the user list when they can.
// Non-admins get isAdmin:false and an empty list (no error) so the UI can simply
// hide the section.
export const getUserManagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await isAdminUser(context.userId);
    if (!isAdmin) return { isAdmin: false, users: [], selfId: context.userId };
    const users = await listManagedUsers(context.userId);
    return { isAdmin: true, users, selfId: context.userId };
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email().max(160),
        display_name: z.string().max(120).optional().nullable(),
        origin: z.string().max(300).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const result = await inviteWorkshopUser(context.userId, data.email, data.origin, data.display_name);
    return { ok: true, user: result };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await deleteWorkshopUser(context.userId, data.user_id);
    return { ok: true };
  });

// Admin: look up another account by email and return its editable settings.
export const adminGetUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ email: z.string().email().max(160) }).parse(d))
  .handler(async ({ data, context }) => {
    return getManagedUserSettings(context.userId, data.email);
  });

// Admin: persist edited settings for the target account.
export const adminUpdateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ user_id: z.string().uuid(), patch: managedSettingsSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      if (typeof v === "string") {
        cleaned[k] = v.trim() === "" ? null : v.trim();
      } else {
        cleaned[k] = v;
      }
    }
    await updateManagedUserSettings(context.userId, data.user_id, cleaned);
    return { ok: true };
  });

export const adminUploadInvoiceLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        file_base64: z.string().max(6_000_000),
        file_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const url = await adminUploadUserInvoiceLogo(
      context.userId,
      data.user_id,
      data.file_base64,
      data.file_type,
    );
    return { url };
  });
