import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  assertScandicOwner,
  normalizePhone,
  send46elksSms,
  composeInitialMessage,
  composeManualBookingMessage,
  sendBookingNotificationEmail,
  SCANDIC_OWNER_ID,
  buildDaySlots,
  fakeBusyKeysForDate,
  isWeekendDateKey,
  stockholmWallToUtcIso,
} from "./scandic.server";

export const isScandicOwner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { allowed: context.userId === SCANDIC_OWNER_ID };
  });

export const listScandicLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertScandicOwner(context.userId);
    const { data: leads, error } = await supabaseAdmin
      .from("scandic_leads")
      .select("*")
      .eq("owner_id", SCANDIC_OWNER_ID)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (leads ?? []).map((l) => l.id);
    let messages: Array<{ id: string; lead_id: string; direction: string; body: string; created_at: string; reminder_kind: string | null }> = [];
    let bookings: Array<{ id: string; lead_id: string; slot_start: string; slot_end: string }> = [];
    if (ids.length) {
      const [{ data: msgs }, { data: bks }] = await Promise.all([
        supabaseAdmin.from("scandic_messages").select("id, lead_id, direction, body, created_at, reminder_kind").in("lead_id", ids).order("created_at", { ascending: true }),
        supabaseAdmin.from("scandic_bookings").select("id, lead_id, slot_start, slot_end").in("lead_id", ids),
      ]);
      messages = msgs ?? [];
      bookings = bks ?? [];
    }
    return { leads: leads ?? [], messages, bookings };
  });

export const createScandicLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      phone: z.string().min(5).max(40),
      name: z.string().max(120).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertScandicOwner(context.userId);
    const phone = normalizePhone(data.phone);
    const name = data.name?.trim() || null;

    // upsert by (owner, phone)
    const { data: existing } = await supabaseAdmin
      .from("scandic_leads")
      .select("*")
      .eq("owner_id", SCANDIC_OWNER_ID)
      .eq("phone", phone)
      .maybeSingle();

    let lead = existing;
    if (!lead) {
      const { data: inserted, error } = await supabaseAdmin
        .from("scandic_leads")
        .insert({ owner_id: SCANDIC_OWNER_ID, phone, name })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      lead = inserted;
    } else if (name && !lead.name) {
      const { data: upd } = await supabaseAdmin
        .from("scandic_leads")
        .update({ name })
        .eq("id", lead.id)
        .select("*")
        .single();
      if (upd) lead = upd;
    }

    // Send initial SMS (only if not yet sent)
    if (!lead.initial_sent_at) {
      const msg = composeInitialMessage(lead.name, lead.booking_token);
      const r = await send46elksSms(phone, msg);
      await supabaseAdmin.from("scandic_messages").insert({
        lead_id: lead.id,
        direction: "out",
        body: msg,
        reminder_kind: "initial",
        elks_id: r.id ?? null,
      });
      const { data: updated } = await supabaseAdmin
        .from("scandic_leads")
        .update({ initial_sent_at: new Date().toISOString() })
        .eq("id", lead.id)
        .select("*")
        .single();
      if (updated) lead = updated;
    }

    return { lead };
  });

export const updateScandicLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().max(120).optional().nullable(),
      email: z.string().email().max(160).optional().nullable().or(z.literal("")),
      status: z.enum(["pending", "booked", "cancelled"]).optional(),
      opted_out: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertScandicOwner(context.userId);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name?.trim() || null;
    if (data.email !== undefined) patch.email = data.email === "" ? null : data.email;
    if (data.status !== undefined) patch.status = data.status;
    if (data.opted_out !== undefined) patch.opted_out = data.opted_out;
    const { data: updated, error } = await supabaseAdmin
      .from("scandic_leads")
      .update(patch as never)
      .eq("id", data.id)
      .eq("owner_id", SCANDIC_OWNER_ID)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { lead: updated };
  });

export const deleteScandicLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertScandicOwner(context.userId);
    const { error } = await supabaseAdmin
      .from("scandic_leads")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", SCANDIC_OWNER_ID);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Admin books an appointment on behalf of a customer (no SMS is sent —
// the admin copies the returned message and sends it manually).
export const createManualScandicBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      phone: z.string().min(5).max(40),
      name: z.string().min(1).max(120),
      email: z.string().email().max(160).optional().nullable().or(z.literal("")),
      isoStart: z.string().min(10).max(40),
      meetingType: z.enum(["zoom", "meet", "teams", "in_person"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertScandicOwner(context.userId);
    const phone = normalizePhone(data.phone);
    const email = data.email ? data.email : null;
    const name = data.name.trim();

    const start = new Date(data.isoStart);
    if (isNaN(start.getTime())) throw new Error("Ogiltig tid");
    const end = new Date(start.getTime() + 30 * 60_000);

    // Upsert lead by (owner, phone) — without sending any SMS
    const { data: existing } = await supabaseAdmin
      .from("scandic_leads")
      .select("*")
      .eq("owner_id", SCANDIC_OWNER_ID)
      .eq("phone", phone)
      .maybeSingle();

    let lead = existing;
    if (!lead) {
      const { data: inserted, error } = await supabaseAdmin
        .from("scandic_leads")
        .insert({ owner_id: SCANDIC_OWNER_ID, phone, name, email })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      lead = inserted;
    }

    const { error: bErr } = await supabaseAdmin.from("scandic_bookings").insert({
      lead_id: lead.id,
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      name,
      email: email ?? lead.email ?? "",
      phone,
      question: null,
      meeting_type: data.meetingType,
    });
    if (bErr) {
      if (bErr.code === "23505") throw new Error("Tiden är redan tagen. Välj en annan tid.");
      throw new Error(bErr.message);
    }

    const { data: updatedLead } = await supabaseAdmin
      .from("scandic_leads")
      .update({
        status: "booked",
        name: lead.name ?? name,
        email: lead.email ?? email,
      })
      .eq("id", lead.id)
      .select("*")
      .single();
    if (updatedLead) lead = updatedLead;

    const message = composeManualBookingMessage(name, lead.booking_token, start, data.meetingType);

    // Log the message in the conversation so it shows in the history
    await supabaseAdmin.from("scandic_messages").insert({
      lead_id: lead.id,
      direction: "out",
      body: message,
      reminder_kind: "manuell bokning",
      elks_id: null,
    });

    return { lead, message };
  });

// ============ Public booking ============

export const getScandicBookingPage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      token: z.string().min(8).max(64),
      // dateKey in yyyy-mm-dd (Stockholm local) — defaults to today
      dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: lead, error } = await supabaseAdmin
      .from("scandic_leads")
      .select("id, name, phone, email, question, status, booking_token")
      .eq("booking_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Hittade inte länken");

    // If already booked, include the booking so the page can show
    // confirmation + add-to-calendar buttons.
    let booking: { slotStart: string; slotEnd: string; meetingType: string } | null = null;
    if (lead.status === "booked") {
      const { data: bk } = await supabaseAdmin
        .from("scandic_bookings")
        .select("slot_start, slot_end, meeting_type")
        .eq("lead_id", lead.id)
        .order("slot_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (bk) booking = { slotStart: bk.slot_start, slotEnd: bk.slot_end, meetingType: bk.meeting_type ?? "zoom" };
    }

    // Build next 14 days of date keys (Stockholm) skipping weekends
    const days: Array<{ dateKey: string; slots: Array<{ time: string; isoStart: string; available: boolean }> }> = [];
    const base = new Date();
    const sthFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" });
    let added = 0;
    let offset = 0;
    // Collect taken slots in range
    const allDateKeys: string[] = [];
    while (added < 14) {
      const d = new Date(base.getTime() + offset * 86400_000);
      const key = sthFmt.format(d);
      offset++;
      if (isWeekendDateKey(key)) continue;
      allDateKeys.push(key);
      added++;
    }
    const firstIso = stockholmWallToUtcIso(...(allDateKeys[0].split("-").map(Number) as [number, number, number]), 0, 0);
    const lastParts = allDateKeys[allDateKeys.length - 1].split("-").map(Number) as [number, number, number];
    const lastIso = stockholmWallToUtcIso(lastParts[0], lastParts[1], lastParts[2], 23, 59);
    const { data: taken } = await supabaseAdmin
      .from("scandic_bookings")
      .select("slot_start")
      .gte("slot_start", firstIso)
      .lte("slot_start", lastIso);
    const takenSet = new Set((taken ?? []).map((t) => t.slot_start));

    for (const key of allDateKeys) {
      const slots = buildDaySlots(key);
      const busy = fakeBusyKeysForDate(key);
      days.push({
        dateKey: key,
        slots: slots.map((s) => ({
          time: `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`,
          isoStart: s.isoStart,
          available: !busy.has(s.localKey) && !takenSet.has(s.isoStart),
        })),
      });
    }

    return {
      lead: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        status: lead.status,
      },
      booking,
      days,
      selectedDateKey: data.dateKey ?? days[0].dateKey,
    };
  });

export const submitScandicBooking = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      token: z.string().min(8).max(64),
      isoStart: z.string().min(10).max(40),
      name: z.string().min(1).max(120),
      email: z.string().email().max(160),
      phone: z.string().min(5).max(40),
      question: z.string().max(2000).optional().nullable(),
      meetingType: z.enum(["zoom", "meet", "teams", "in_person"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: lead, error } = await supabaseAdmin
      .from("scandic_leads")
      .select("*")
      .eq("booking_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Ogiltig länk");
    if (lead.status === "booked") throw new Error("Du har redan bokat en tid. Hör av dig om du vill byta.");

    const start = new Date(data.isoStart);
    if (isNaN(start.getTime())) throw new Error("Ogiltig tid");
    const end = new Date(start.getTime() + 30 * 60_000);

    const { error: bErr } = await supabaseAdmin.from("scandic_bookings").insert({
      lead_id: lead.id,
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      name: data.name,
      email: data.email,
      phone: normalizePhone(data.phone),
      question: data.question ?? null,
      meeting_type: data.meetingType,
    });
    if (bErr) {
      if (bErr.code === "23505") throw new Error("Tiden är tyvärr redan tagen. Välj en annan.");
      throw new Error(bErr.message);
    }

    await supabaseAdmin
      .from("scandic_leads")
      .update({
        status: "booked",
        name: lead.name ?? data.name,
        email: lead.email ?? data.email,
        question: lead.question ?? (data.question ?? null),
      })
      .eq("id", lead.id);

    // Notify the owner by email — never block the booking on failure.
    try {
      await sendBookingNotificationEmail({
        name: data.name,
        phone: normalizePhone(data.phone),
        email: data.email,
        slotStart: start,
        meetingType: data.meetingType,
        question: data.question ?? null,
      });
    } catch (e) {
      console.error("[scandic] Failed to send booking notification email:", e);
    }

    return { ok: true };
  });