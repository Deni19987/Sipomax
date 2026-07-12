import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OPPORTUNITIES_BASE_PROMPT } from "./ai-prompts";
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

export async function listOpportunities(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const items = data ?? [];

  // Fetch full chat history for all referenced jobs
  const jobIds = Array.from(new Set(items.map((i) => i.job_id).filter((v): v is string => Boolean(v))));
  const chatsByJob = new Map<string, Array<{ id: string; sender_type: string; body: string; created_at: string }>>();
  if (jobIds.length) {
    const { data: msgs, error: mErr } = await supabaseAdmin
      .from("messages")
      .select("id, job_id, sender_type, body, created_at")
      .in("job_id", jobIds)
      .order("created_at", { ascending: true });
    if (mErr) throw new Error(mErr.message);
    for (const m of msgs ?? []) {
      const arr = chatsByJob.get(m.job_id) ?? [];
      arr.push({ id: m.id, sender_type: m.sender_type, body: m.body, created_at: m.created_at });
      chatsByJob.set(m.job_id, arr);
    }
  }

  return items.map((i) => ({
    ...i,
    chat: i.job_id ? chatsByJob.get(i.job_id) ?? [] : [],
  }));
}

export async function generateOpportunities(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);

  // Load user's optional extra prompt instructions
  const { data: profileRow } = await supabaseAdmin
    .from("profiles")
    .select("opportunity_prompt_extra")
    .eq("id", workshopId)
    .maybeSingle();
  const extra = (profileRow?.opportunity_prompt_extra ?? "").trim();
  const devBases = await getDeveloperBasePrompts();
  const basePrompt = devBases.opportunity || OPPORTUNITIES_BASE_PROMPT;

  // Phase 1: fetch jobs (scoped to workshop) and existing opportunities in parallel.
  const [{ data: jobs, error: jobsErr }, { data: existing, error: exErr }] = await Promise.all([
    supabaseAdmin.from("jobs").select("id, registration_number, customer_name, customer_phone, customer_email, vehicle_make, vehicle_model, vehicle_type, mileage, owner_count, last_inspection_date, next_inspection_date, current_status, archived_at, created_at, updated_at, notes").eq("workshop_id", workshopId).order("updated_at", { ascending: false }),
    supabaseAdmin.from("opportunities").select("job_id, opportunity_type, status").eq("workshop_id", workshopId),
  ]);
  if (jobsErr) throw new Error(jobsErr.message);
  if (exErr) throw new Error(exErr.message);

  const jobIds = (jobs ?? []).map((j) => j.id);

  // Phase 2: fetch messages and status updates scoped to this user's jobs.
  const [{ data: messages, error: msgErr }, { data: updates, error: upErr }] = await Promise.all([
    jobIds.length
      ? supabaseAdmin.from("messages").select("job_id, sender_type, body, created_at").in("job_id", jobIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as any[], error: null }),
    jobIds.length
      ? supabaseAdmin.from("status_updates").select("job_id, status, description, quote_amount, approval_state, created_at").in("job_id", jobIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (msgErr) throw new Error(msgErr.message);
  if (upErr) throw new Error(upErr.message);

  const msgsByJob = new Map<string, Array<{ sender_type: string; body: string; created_at: string }>>();
  for (const m of messages ?? []) {
    const arr = msgsByJob.get(m.job_id) ?? [];
    arr.push({ sender_type: m.sender_type, body: m.body, created_at: m.created_at });
    msgsByJob.set(m.job_id, arr);
  }
  const updsByJob = new Map<string, Array<{ status: string; description: string | null; quote_amount: number | null; approval_state: string | null; created_at: string }>>();
  for (const u of updates ?? []) {
    const arr = updsByJob.get(u.job_id) ?? [];
    arr.push({ status: u.status, description: u.description, quote_amount: u.quote_amount, approval_state: u.approval_state, created_at: u.created_at });
    updsByJob.set(u.job_id, arr);
  }

  // Exclude jobs already with a non-dismissed opportunity (to avoid duplicates)
  const skipJob = new Set<string>();
  const existingKeys = new Set<string>();
  for (const e of existing ?? []) {
    if (e.status === "dismissed") continue;
    if (e.job_id) skipJob.add(e.job_id);
    existingKeys.add(`${e.job_id ?? "null"}::${(e.opportunity_type ?? "").toLowerCase()}`);
  }

  const summarized = (jobs ?? [])
    .filter((j) => !skipJob.has(j.id))
    .slice(0, 50)
    .map((j) => ({
      job_id: j.id,
      registration_number: j.registration_number,
      customer_name: j.customer_name,
      customer_phone: j.customer_phone,
      vehicle: [j.vehicle_make, j.vehicle_model, j.vehicle_type].filter(Boolean).join(" "),
      mileage: j.mileage,
      owner_count: j.owner_count,
      next_inspection_date: j.next_inspection_date,
      current_status: j.current_status,
      archived_at: j.archived_at,
      last_activity: j.updated_at,
      created: j.created_at,
      notes: j.notes,
      chat: (msgsByJob.get(j.id) ?? []).slice(-20).map((m) => ({
        message_id: (m as { id?: string }).id ?? null,
        who: m.sender_type === "workshop" ? "Verkstad" : "Kund",
        text: m.body,
        at: m.created_at,
      })),
      status_history: (updsByJob.get(j.id) ?? []).slice(-10).map((u) => ({
        status: u.status,
        approval_state: u.approval_state,
        quote_amount: u.quote_amount,
        description: u.description,
        at: u.created_at,
      })),
    }));

  const system = extra
    ? `${basePrompt}\n\nEXTRA INSTRUKTIONER FRÅN VERKSTADEN (väger tungt, följ när det inte motsäger ovan):\n${extra}`
    : basePrompt;

  const userPayload = JSON.stringify({ now: new Date().toISOString(), jobs: summarized });

  const raw = await callAi(
    [
      { role: "system", content: system },
      { role: "user", content: userPayload },
    ],
    true,
  );

  let parsed: { opportunities?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returnerade ogiltig JSON");
  }
  const list = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
  if (!list.length) return { created: 0 };

  const jobsById = new Map((jobs ?? []).map((j) => [j.id, j]));

  const rows = list
    .map((o) => {
      const jid = typeof o.job_id === "string" ? o.job_id : null;
      const job = jid ? jobsById.get(jid) : null;
      const phone = (o.customer_phone as string | undefined) ?? job?.customer_phone ?? null;
      const name = (o.customer_name as string | undefined) ?? job?.customer_name ?? "Okänd";
      const sendAt = typeof o.suggested_send_at === "string" ? new Date(o.suggested_send_at) : null;
      const validSend = sendAt && !isNaN(sendAt.getTime()) ? sendAt.toISOString() : new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      return {
        created_by: userId,
        workshop_id: workshopId,
        job_id: job ? job.id : null,
        customer_name: String(name).slice(0, 200),
        customer_phone: phone,
        opportunity_type: String(o.opportunity_type ?? "övrig").slice(0, 80),
        title: String(o.title ?? "Möjlighet").slice(0, 200),
        reason: String(o.reason ?? "").slice(0, 1000),
        suggested_message: String(o.suggested_message ?? "").slice(0, 1000),
        suggested_send_at: validSend,
        status: "pending" as const,
        trigger_message_ids: Array.isArray(o.trigger_message_ids)
          ? (o.trigger_message_ids as unknown[])
              .filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v))
              .slice(0, 20)
          : [],
        trigger_context: typeof o.trigger_context === "string" && o.trigger_context.trim()
          ? o.trigger_context.slice(0, 500)
          : null,
      };
    })
    .filter((r) => r.suggested_message.length > 0);

  if (!rows.length) return { created: 0 };

  // Final safety net: drop rows that match an existing active opp by (job, type)
  const filteredRows = rows.filter(
    (r) => !existingKeys.has(`${r.job_id ?? "null"}::${r.opportunity_type.toLowerCase()}`),
  );
  if (!filteredRows.length) return { created: 0 };

  const { error: insErr } = await supabaseAdmin.from("opportunities").insert(filteredRows);
  if (insErr) throw new Error(insErr.message);
  return { created: filteredRows.length };
}

export async function updateOpportunity(
  userId: string,
  id: string,
  patch: { suggested_message?: string; suggested_send_at?: string },
) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const update: { suggested_message?: string; suggested_send_at?: string } = {};
  if (patch.suggested_message !== undefined) update.suggested_message = patch.suggested_message.slice(0, 1000);
  if (patch.suggested_send_at !== undefined) update.suggested_send_at = patch.suggested_send_at;
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .update(update)
    .eq("id", id)
    .eq("workshop_id", workshopId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function approveOpportunity(userId: string, id: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .update({ status: "approved" })
    .eq("id", id)
    .eq("workshop_id", workshopId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function dismissOpportunity(userId: string, id: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { error } = await supabaseAdmin.from("opportunities").update({ status: "dismissed" }).eq("id", id).eq("workshop_id", workshopId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function rewriteOpportunityMessage(
  userId: string,
  id: string,
  instructions: string | null,
) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data: opp, error } = await supabaseAdmin.from("opportunities").select("*").eq("id", id).eq("workshop_id", workshopId).single();
  if (error) throw new Error(error.message);

  const system = `Du förbättrar ett SMS från en svensk bilverkstad till en kund. Behåll budskapet, lägg INTE till nya fakta. Skriv i sms-stil: informellt, naturligt, max 320 tecken. Signera med "Verkstaden". Returnera endast meddelandetexten.`;
  const user = `Kund: ${opp.customer_name}
Anledning: ${opp.reason}
Nuvarande utkast:
${opp.suggested_message}

${instructions ? `Instruktion: ${instructions}` : "Förbättra texten lätt."}`;

  const text = await callAi([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const { data: updated, error: uerr } = await supabaseAdmin
    .from("opportunities")
    .update({ suggested_message: text.slice(0, 1000) })
    .eq("id", id)
    .eq("workshop_id", workshopId)
    .select("*")
    .single();
  if (uerr) throw new Error(uerr.message);
  return updated;
}

export async function sendDueOpportunities() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("status", "approved")
    .lte("suggested_send_at", nowIso)
    .limit(50);
  if (error) throw new Error(error.message);

  const username = process.env.ELKS_API_USERNAME?.trim();
  const password = process.env.ELKS_API_PASSWORD?.trim();
  const sender = process.env.ELKS_SENDER?.trim();

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const opp of due ?? []) {
    if (!opp.customer_phone) {
      await supabaseAdmin.from("opportunities").update({ status: "failed", send_error: "Inget telefonnummer" }).eq("id", opp.id);
      results.push({ id: opp.id, ok: false, error: "no_phone" });
      continue;
    }
    if (!username || !password || !sender) {
      await supabaseAdmin.from("opportunities").update({ status: "failed", send_error: "46elks ej konfigurerat" }).eq("id", opp.id);
      results.push({ id: opp.id, ok: false, error: "no_creds" });
      continue;
    }
    try {
      const body = new URLSearchParams({
        from: sender,
        to: normalizePhone(opp.customer_phone),
        message: opp.suggested_message,
      });
      const auth = btoa(`${username}:${password}`);
      const res = await fetch("https://api.46elks.com/a1/sms", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`46elks ${res.status}: ${text.slice(0, 200)}`);
      await supabaseAdmin
        .from("opportunities")
        .update({ status: "sent", sent_at: new Date().toISOString(), send_error: null })
        .eq("id", opp.id);
      results.push({ id: opp.id, ok: true });
    } catch (e) {
      await supabaseAdmin
        .from("opportunities")
        .update({ status: "failed", send_error: (e as Error).message.slice(0, 500) })
        .eq("id", opp.id);
      results.push({ id: opp.id, ok: false, error: (e as Error).message });
    }
  }
  return { processed: results.length, results };
}