import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SERVICE_CAMPAIGN_BASE_PROMPT, DEFAULT_SERVICE_METRIC_KEYS } from "./ai-prompts";
import { getDeveloperBasePrompts, getWorkshopId } from "./profile.server";

async function assertWorkshopUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "workshop")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have workshop access");
}

function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s-]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return `+${p.slice(2)}`;
  if (p.startsWith("0")) return `+46${p.slice(1)}`;
  return `+${p}`;
}

async function callAi(messages: Array<{ role: string; content: string }>, jsonMode = false): Promise<string> {
  const { callGemini } = await import("./ai-client.server");
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
  return callGemini(system, user, jsonMode);
}

export type Recipient = {
  job_id: string | null;
  customer_name: string;
  customer_first_name: string;
  customer_phone: string | null;
  registration_number: string | null;
  predicted_service_due_date: string | null;
  predicted_reason: string | null;
};

export async function listCampaigns(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Heuristic: pick latest job per registration (vehicle) and infer service-due signals
type JobRow = {
  id: string;
  registration_number: string;
  customer_name: string;
  customer_first_name: string | null;
  customer_phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  model_year: number | null;
  engine_type: string | null;
  engine_code: string | null;
  gearbox_type: string | null;
  vin: string | null;
  mileage: number | null;
  mileage_recorded_at: string | null;
  mileage_source: string | null;
  mileage_at_last_service: number | null;
  last_service_at: string | null;
  avg_km_per_month: number | null;
  recommended_service_interval_km: number | null;
  recommended_service_interval_months: number | null;
  next_inspection_date: string | null;
  notes: string | null;
  current_status: string;
  created_at: string;
  updated_at: string;
};

function latestPerVehicle(jobs: JobRow[]): JobRow[] {
  const map = new Map<string, JobRow>();
  for (const j of jobs) {
    const key = (j.registration_number || j.id).toUpperCase();
    const prev = map.get(key);
    if (!prev || new Date(j.updated_at) > new Date(prev.updated_at)) map.set(key, j);
  }
  return Array.from(map.values());
}

export async function generateServiceDueCampaigns(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);

  // Load workshop owner's optional extra prompt + allowed metric keys
  const { data: profileRow } = await supabaseAdmin
    .from("profiles")
    .select("service_prompt_extra, service_metrics")
    .eq("id", workshopId)
    .maybeSingle();
  const extra = (profileRow?.service_prompt_extra ?? "").trim();
  const devBases = await getDeveloperBasePrompts();
  const basePrompt = devBases.service || SERVICE_CAMPAIGN_BASE_PROMPT;
  const allowedMetrics = new Set<string>(
    profileRow?.service_metrics && profileRow.service_metrics.length > 0
      ? profileRow.service_metrics
      : DEFAULT_SERVICE_METRIC_KEYS,
  );

  // Phase 1: fetch jobs scoped to this workshop.
  const { data: jobs, error: jobsErr } = (await supabaseAdmin
    .from("jobs")
    .select(
      "id, registration_number, customer_name, customer_first_name, customer_phone, vehicle_make, vehicle_model, model_year, engine_type, engine_code, gearbox_type, vin, mileage, mileage_recorded_at, mileage_source, mileage_at_last_service, last_service_at, avg_km_per_month, recommended_service_interval_km, recommended_service_interval_months, next_inspection_date, notes, current_status, created_at, updated_at",
    )
    .eq("workshop_id", workshopId)
    .order("updated_at", { ascending: false })) as unknown as { data: JobRow[] | null; error: { message: string } | null };
  if (jobsErr) throw new Error(jobsErr.message);

  const jobIds = (jobs ?? []).map((j) => j.id);

  // Phase 2: fetch messages scoped to this user's jobs.
  const { data: messages, error: msgErr } = jobIds.length
    ? await supabaseAdmin.from("messages").select("job_id, sender_type, body, created_at").in("job_id", jobIds).order("created_at", { ascending: true })
    : { data: [] as any[], error: null };
  if (msgErr) throw new Error(msgErr.message);

  const msgsByJob = new Map<string, Array<{ sender_type: string; body: string; created_at: string }>>();
  for (const m of messages ?? []) {
    const arr = msgsByJob.get(m.job_id) ?? [];
    arr.push({ sender_type: m.sender_type, body: m.body, created_at: m.created_at });
    msgsByJob.set(m.job_id, arr);
  }

  const vehicles = latestPerVehicle((jobs ?? []) as JobRow[]);
  // Personal first name only — never the resolved (possibly company) customer_name.
  // Used for SMS personalization so customer-facing messages never address a company.
  const firstNameByJobId = new Map<string, string>(
    vehicles.map((j) => [j.id, j.customer_first_name?.trim() || (j.customer_name || "").split(/\s+/)[0] || j.customer_name || ""]),
  );

  const payload = vehicles.slice(0, 80).map((j) => {
    const vehicle: Record<string, unknown> = {};
    if (allowedMetrics.has("vehicle.make")) vehicle.make = j.vehicle_make;
    if (allowedMetrics.has("vehicle.model")) vehicle.model = j.vehicle_model;
    if (allowedMetrics.has("vehicle.model_year")) vehicle.model_year = j.model_year;
    if (allowedMetrics.has("vehicle.engine_type")) vehicle.engine_type = j.engine_type;
    if (allowedMetrics.has("vehicle.engine_code")) vehicle.engine_code = j.engine_code;
    if (allowedMetrics.has("vehicle.gearbox_type")) vehicle.gearbox_type = j.gearbox_type;
    if (allowedMetrics.has("vehicle.vin")) vehicle.vin = j.vin;

    const base: Record<string, unknown> = {
      job_id: j.id,
      customer_name: j.customer_name,
      customer_phone: j.customer_phone,
      registration_number: j.registration_number,
      vehicle,
    };
    if (allowedMetrics.has("mileage")) base.mileage = j.mileage;
    if (allowedMetrics.has("mileage_recorded_at")) base.mileage_recorded_at = j.mileage_recorded_at;
    if (allowedMetrics.has("mileage_source")) base.mileage_source = j.mileage_source;
    if (allowedMetrics.has("mileage_at_last_service")) base.mileage_at_last_service = j.mileage_at_last_service;
    if (allowedMetrics.has("last_service_at")) base.last_service_at = j.last_service_at;
    if (allowedMetrics.has("avg_km_per_month")) base.avg_km_per_month = j.avg_km_per_month;
    if (allowedMetrics.has("recommended_service_interval_km")) base.recommended_service_interval_km = j.recommended_service_interval_km;
    if (allowedMetrics.has("recommended_service_interval_months")) base.recommended_service_interval_months = j.recommended_service_interval_months;
    if (allowedMetrics.has("next_inspection_date")) base.next_inspection_date = j.next_inspection_date;
    if (allowedMetrics.has("last_chat_excerpt")) {
      base.last_chat_excerpt = (msgsByJob.get(j.id) ?? [])
        .slice(-6)
        .map((m) => `${m.sender_type === "workshop" ? "V" : "K"}: ${m.body}`)
        .join(" | ")
        .slice(0, 600);
    }
    if (allowedMetrics.has("notes")) base.notes = j.notes;
    return base;
  });

  const system = extra
    ? `${basePrompt}\n\nEXTRA INSTRUKTIONER FRÅN VERKSTADEN (väger tungt, följ när det inte motsäger ovan):\n${extra}`
    : basePrompt;

  const raw = await callAi(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ now: new Date().toISOString(), vehicles: payload }) },
    ],
    true,
  );

  let parsed: { campaigns?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returnerade ogiltig JSON");
  }
  const list = Array.isArray(parsed.campaigns) ? parsed.campaigns : [];
  if (!list.length) return { created: 0 };

  // Update jobs with AI-learned recommended service intervals
  const intervalUpdates = new Map<string, { km?: number; months?: number }>();
  for (const c of list) {
    const recs = Array.isArray((c as { recipients?: unknown }).recipients) ? (c as { recipients: Array<Record<string, unknown>> }).recipients : [];
    for (const r of recs) {
      const jid = typeof r.job_id === "string" ? r.job_id : null;
      if (!jid) continue;
      const km = typeof r.recommended_interval_km === "number" ? r.recommended_interval_km : undefined;
      const months = typeof r.recommended_interval_months === "number" ? r.recommended_interval_months : undefined;
      if (km || months) intervalUpdates.set(jid, { km, months });
    }
  }
  for (const [jid, vals] of intervalUpdates.entries()) {
    const upd: { recommended_service_interval_km?: number; recommended_service_interval_months?: number } = {};
    if (vals.km) upd.recommended_service_interval_km = vals.km;
    if (vals.months) upd.recommended_service_interval_months = vals.months;
    if (Object.keys(upd).length) await supabaseAdmin.from("jobs").update(upd).eq("id", jid);
  }

  const rows = list
    .map((c) => {
      const recsRaw = Array.isArray((c as { recipients?: unknown }).recipients) ? (c as { recipients: Array<Record<string, unknown>> }).recipients : [];
      const recipients: Recipient[] = recsRaw
        .map((r) => {
          const jobId = typeof r.job_id === "string" ? r.job_id : null;
          const customerName = String(r.customer_name ?? "Okänd").slice(0, 200);
          return {
            job_id: jobId,
            customer_name: customerName,
            customer_first_name: (jobId && firstNameByJobId.get(jobId)) || customerName.split(/\s+/)[0] || customerName,
            customer_phone: typeof r.customer_phone === "string" && r.customer_phone ? r.customer_phone : null,
            registration_number: typeof r.registration_number === "string" ? r.registration_number : null,
            predicted_service_due_date: typeof r.predicted_service_due_date === "string" ? r.predicted_service_due_date : null,
            predicted_reason: typeof r.predicted_reason === "string" ? r.predicted_reason : null,
          };
        })
        .filter((r) => r.customer_phone);
      if (!recipients.length) return null;
      const sendAt = typeof c.suggested_send_at === "string" ? new Date(c.suggested_send_at) : null;
      const validSend = sendAt && !isNaN(sendAt.getTime()) ? sendAt.toISOString() : new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      return {
        created_by: userId,
        workshop_id: workshopId,
        campaign_type: String(c.campaign_type ?? "service_due_soon").slice(0, 80),
        title: String(c.title ?? "Service-påminnelse").slice(0, 200),
        reason: String(c.reason ?? "").slice(0, 1000),
        suggested_message: String(c.suggested_message ?? "").slice(0, 1000),
        suggested_send_at: validSend,
        recipients,
        status: "pending" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.suggested_message.length > 0);

  if (!rows.length) return { created: 0 };

  const { error: insErr } = await supabaseAdmin.from("campaigns").insert(rows);
  if (insErr) throw new Error(insErr.message);
  return { created: rows.length };
}

export async function updateCampaign(
  userId: string,
  id: string,
  patch: { suggested_message?: string; suggested_send_at?: string; recipients?: Recipient[] },
) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const update: { suggested_message?: string; suggested_send_at?: string; recipients?: Recipient[] } = {};
  if (patch.suggested_message !== undefined) update.suggested_message = patch.suggested_message.slice(0, 1000);
  if (patch.suggested_send_at !== undefined) update.suggested_send_at = patch.suggested_send_at;
  if (patch.recipients !== undefined) update.recipients = patch.recipients;
  const { data, error } = await supabaseAdmin.from("campaigns").update(update).eq("id", id).eq("workshop_id", workshopId).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function approveCampaign(userId: string, id: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin.from("campaigns").update({ status: "approved" }).eq("id", id).eq("workshop_id", workshopId).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function dismissCampaign(userId: string, id: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { error } = await supabaseAdmin.from("campaigns").update({ status: "dismissed" }).eq("id", id).eq("workshop_id", workshopId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function rewriteCampaignMessage(userId: string, id: string, instructions: string | null) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data: c, error } = await supabaseAdmin.from("campaigns").select("*").eq("id", id).eq("workshop_id", workshopId).single();
  if (error) throw new Error(error.message);

  const system = `Du förbättrar ett mall-SMS från en svensk bilverkstad. Behåll budskapet, behåll platshållaren {namn}, lägg INTE till nya fakta. Informellt, max 320 tecken. Signera "Verkstaden". Returnera endast meddelandetexten.`;
  const user = `Anledning: ${c.reason}
Nuvarande utkast:
${c.suggested_message}

${instructions ? `Instruktion: ${instructions}` : "Förbättra texten lätt."}`;

  const text = await callAi([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const { data: updated, error: uerr } = await supabaseAdmin
    .from("campaigns")
    .update({ suggested_message: text.slice(0, 1000) })
    .eq("id", id)
    .eq("workshop_id", workshopId)
    .select("*")
    .single();
  if (uerr) throw new Error(uerr.message);
  return updated;
}

export async function sendDueCampaigns() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("status", "approved")
    .lte("suggested_send_at", nowIso)
    .limit(20);
  if (error) throw new Error(error.message);

  const username = process.env.ELKS_API_USERNAME?.trim();
  const password = process.env.ELKS_API_PASSWORD?.trim();
  const sender = process.env.ELKS_SENDER?.trim();

  const out: Array<{ id: string; sent: number; failed: number; error?: string }> = [];
  for (const camp of due ?? []) {
    if (!username || !password || !sender) {
      await supabaseAdmin.from("campaigns").update({ status: "failed", send_error: "46elks ej konfigurerat" }).eq("id", camp.id);
      out.push({ id: camp.id, sent: 0, failed: 0, error: "no_creds" });
      continue;
    }
    const recipients = Array.isArray(camp.recipients) ? (camp.recipients as Recipient[]) : [];
    const results: Array<{ name: string; ok: boolean; error?: string }> = [];
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      if (!r.customer_phone) {
        failed++;
        results.push({ name: r.customer_name, ok: false, error: "no_phone" });
        continue;
      }
      const personalized = String(camp.suggested_message).replace(/\{namn\}/gi, r.customer_first_name || r.customer_name.split(" ")[0] || r.customer_name);
      try {
        const auth = btoa(`${username}:${password}`);
        const body = new URLSearchParams({ from: sender, to: normalizePhone(r.customer_phone), message: personalized });
        const res = await fetch("https://api.46elks.com/a1/sms", {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const txt = await res.text();
        if (!res.ok) throw new Error(`46elks ${res.status}: ${txt.slice(0, 200)}`);
        sent++;
        results.push({ name: r.customer_name, ok: true });
      } catch (e) {
        failed++;
        results.push({ name: r.customer_name, ok: false, error: (e as Error).message });
      }
    }
    await supabaseAdmin
      .from("campaigns")
      .update({
        status: failed === recipients.length && sent === 0 ? "failed" : "sent",
        sent_at: new Date().toISOString(),
        send_error: failed === recipients.length && sent === 0 ? "Alla mottagare misslyckades" : null,
        send_results: { sent, failed, details: results },
      })
      .eq("id", camp.id);
    out.push({ id: camp.id, sent, failed });
  }
  return { processed: out.length, results: out };
}