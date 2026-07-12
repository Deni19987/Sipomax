import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyJobAccess, supabaseAdmin, signJobAttachmentUrls } from "./customer.server";
import { sendPushToWorkshop } from "./push.server";
import { getWorkshopId } from "./profile.server";

// Resolve the owning workshop for a job so notifications reach every account
// in it. New jobs carry workshop_id (the owner); older rows fall back to
// resolving the creator's workshop.
async function resolveWorkshopId(job: {
  workshop_id?: string | null;
  created_by?: string | null;
}): Promise<string | null> {
  if (job.workshop_id) return job.workshop_id;
  if (job.created_by) return getWorkshopId(job.created_by);
  return null;
}

// Reads a boolean notification preference off the workshop owner's profile
// row (settings are stored once per workshop). Missing column/row => enabled.
async function workshopPrefEnabled(
  workshopId: string,
  column: "notify_customer_messages" | "notify_quote_responses",
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select(column)
    .eq("id", workshopId)
    .maybeSingle();
  return (data as any)?.[column] ?? true;
}

// First + last name only, for a compact notification title.
function shortName(fullName: string | null, fallback: string): string {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1]}`;
  return parts[0] || fallback;
}

const credSchema = z.object({
  token: z.string().min(8).max(128),
  credential: z.string().min(1).max(40),
});

// Auto-generated notes written for the workshop's own audit trail. They render
// under "Meddelande från oss" on the customer's detail page, so strip them —
// the customer still sees the status itself with its generic description.
const WORKSHOP_INTERNAL_DESCRIPTIONS = new Set([
  "Markerad upphämtad automatiskt när fakturan genererades.",
  "Offert godkänd av kunden.",
  "Offert avvisad av kunden.",
]);

function sanitizeUpdatesForCustomer(updates: any[]): any[] {
  return updates
    .filter((u) => {
      // invoice_booked is the workshop's internal Fortnox bookkeeping step —
      // the customer-facing moment is invoice_sent.
      if (u.status === "invoice_booked") return false;
      // Legacy echo rows: before quote responses transformed the quote item in
      // place, responding inserted a bare quote_approved/quote_rejected row.
      // Hide those duplicates — but keep quote_approved rows that carry real
      // content (a workshop pre-approved offer with articles/amount is the
      // offer itself, not an echo).
      if (
        (u.status === "quote_approved" || u.status === "quote_rejected") &&
        u.quote_amount == null &&
        !(Array.isArray(u.articles) && u.articles.length) &&
        !(u.status_update_attachments && u.status_update_attachments.length)
      ) {
        return false;
      }
      return true;
    })
    .map((u) =>
      u.description && WORKSHOP_INTERNAL_DESCRIPTIONS.has(u.description.trim())
        ? { ...u, description: null }
        : u,
    );
}

export const getCustomerJob = createServerFn({ method: "POST" })
  .inputValidator((d) => credSchema.parse(d))
  .handler(async ({ data }) => {
    const job = await verifyJobAccess(data.token, data.credential);
    const [{ data: updates }, { data: messages }] = await Promise.all([
      supabaseAdmin.from("status_updates").select("*, status_update_attachments(*)").eq("job_id", job.id).order("created_at", { ascending: true }),
      supabaseAdmin.from("messages").select("*").eq("job_id", job.id).order("created_at", { ascending: true }),
    ]);
    const signedUpdates = await signJobAttachmentUrls(sanitizeUpdatesForCustomer(updates ?? []));
    return {
      job: {
        id: job.id,
        registration_number: job.registration_number,
        customer_name: job.customer_name,
        vehicle_make: job.vehicle_make,
        vehicle_model: job.vehicle_model,
        current_status: job.current_status,
      },
      updates: signedUpdates,
      messages: messages ?? [],
    };
  });

export const sendCustomerMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => credSchema.extend({ body: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data }) => {
    const job = await verifyJobAccess(data.token, data.credential);
    const { data: msg, error } = await supabaseAdmin.from("messages").insert({
      job_id: job.id,
      sender_type: "customer",
      body: data.body,
    }).select("*").single();
    if (error) throw new Error(error.message);
    // Customer replied — clear any pending chat reminder
    await supabaseAdmin.from("jobs").update({ pending_chat_reminder_at: null }).eq("id", job.id);
    // The push heads-up to the workshop is a slow external side-effect and is
    // handled by notifyCustomerMessage (fired separately by the client) so the
    // message shows in-app immediately.
    return { message: msg };
  });

// Push heads-up to every workshop account that the customer replied. Fired
// separately from sendCustomerMessage so its push round-trips never delay the
// message appearing in the chat. Best-effort.
export const notifyCustomerMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => credSchema.extend({ body: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data }) => {
    const job = await verifyJobAccess(data.token, data.credential);
    try {
      const workshopId = await resolveWorkshopId(job);
      if (workshopId && (await workshopPrefEnabled(workshopId, "notify_customer_messages"))) {
        const firstLast = shortName(job.customer_name, job.registration_number);
        const preview = data.body.length > 140 ? data.body.slice(0, 137) + "..." : data.body;
        const res = await sendPushToWorkshop(workshopId, {
          title: firstLast,
          body: preview,
          url: `/jobs/${job.id}#chat`,
          tag: `job-${job.id}`,
        });
        console.info("[push] customer message notify result", res);
      }
    } catch (e) {
      console.error("[push] customer message notify failed", e);
    }
    return { ok: true };
  });

export const respondToQuote = createServerFn({ method: "POST" })
  .inputValidator((d) => credSchema.extend({
    update_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
  }).parse(d))
  .handler(async ({ data }) => {
    const job = await verifyJobAccess(data.token, data.credential);
    const { data: update, error: ue } = await supabaseAdmin
      .from("status_updates")
      .select("*")
      .eq("id", data.update_id)
      .eq("job_id", job.id)
      .maybeSingle();
    if (ue) throw new Error(ue.message);
    if (!update) throw new Error("Update not found");
    if (!update.requires_approval) throw new Error("This update does not require approval");

    // The quote's timeline item transforms in place (approval_state flips and
    // the UI renders it with an approved/rejected icon) — no extra
    // "quote_approved"/"quote_rejected" row is added to the timeline. The
    // job's own current_status still moves so lists and badges update.
    const { error: upErr } = await supabaseAdmin
      .from("status_updates")
      .update({ approval_state: data.decision })
      .eq("id", update.id);
    if (upErr) throw new Error(upErr.message);

    const newStatus = data.decision === "approved" ? "quote_approved" : "quote_rejected";
    await supabaseAdmin.from("jobs").update({
      current_status: newStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    // Notify every account in the workshop that the customer responded to the
    // quote — this is the moment the workshop can start (or drop) the work.
    try {
      const workshopId = await resolveWorkshopId(job);
      if (workshopId && (await workshopPrefEnabled(workshopId, "notify_quote_responses"))) {
        const firstLast = shortName(job.customer_name, job.registration_number);
        const approved = data.decision === "approved";
        const res = await sendPushToWorkshop(workshopId, {
          title: approved ? "Offert godkänd" : "Offert avvisad",
          body: approved
            ? `${firstLast} godkände offerten (${job.registration_number}).`
            : `${firstLast} avvisade offerten (${job.registration_number}).`,
          url: `/jobs/${job.id}`,
          tag: `job-${job.id}`,
        });
        console.info("[push] quote response notify result", res);
      }
    } catch (e) {
      console.error("[push] quote response notify failed", e);
    }

    return { ok: true };
  });
