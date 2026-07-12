import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPushToUser } from "./push.server";

// How old a pending opp/campaign must be before we nudge the user about it.
const PENDING_AGE_DAYS = 3;
// How often we will at most nudge any single user.
const MIN_HOURS_BETWEEN_REMINDERS = 24;

export async function runPendingReminders() {
  const ageCutoff = new Date(Date.now() - PENDING_AGE_DAYS * 24 * 3600 * 1000).toISOString();
  const sentCutoff = new Date(
    Date.now() - MIN_HOURS_BETWEEN_REMINDERS * 3600 * 1000,
  ).toISOString();

  // Users who want the reminder and haven't been pinged recently
  const { data: profiles, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("id, account_owner_id, pending_reminder_last_sent_at")
    .eq("notify_pending_reminders", true);
  if (pErr) throw new Error(pErr.message);

  const eligible = (profiles ?? []).filter(
    (p) =>
      !p.pending_reminder_last_sent_at ||
      p.pending_reminder_last_sent_at < sentCutoff,
  );

  const results: Array<{ userId: string; opps: number; camps: number; sent: boolean }> = [];

  for (const p of eligible) {
    // Scope by workshop_id (= account_owner_id for team members, own ID for owners)
    const workshopId = (p as any).account_owner_id ?? p.id;
    const [oppRes, campRes] = await Promise.all([
      supabaseAdmin
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("workshop_id", workshopId)
        .eq("status", "pending")
        .lte("created_at", ageCutoff),
      supabaseAdmin
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("workshop_id", workshopId)
        .eq("status", "pending")
        .lte("created_at", ageCutoff),
    ]);
    const opps = oppRes.count ?? 0;
    const camps = campRes.count ?? 0;
    if (opps + camps === 0) {
      results.push({ userId: p.id, opps, camps, sent: false });
      continue;
    }

    const parts: string[] = [];
    if (opps > 0) parts.push(`${opps} uppföljning${opps === 1 ? "" : "ar"}`);
    if (camps > 0) parts.push(`${camps} kampanj${camps === 1 ? "" : "er"}`);
    const body = `Påminnelse: du har ${parts.join(" och ")} som har väntat i mer än ${PENDING_AGE_DAYS} dagar.`;

    try {
      const pushRes = await sendPushToUser(p.id, {
        title: "Sipomax",
        body,
        url: "/insights",
        tag: "pending-reminders",
      });
      console.info("[push] pending reminder sent", { userId: p.id, opps, camps, pushRes });
      await supabaseAdmin
        .from("profiles")
        .update({ pending_reminder_last_sent_at: new Date().toISOString() })
        .eq("id", p.id);
      results.push({ userId: p.id, opps, camps, sent: true });
    } catch (e) {
      console.error("[push] pending reminder failed", p.id, e);
      results.push({ userId: p.id, opps, camps, sent: false });
    }
  }

  return { checked: eligible.length, results };
}