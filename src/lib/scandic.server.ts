import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const SCANDIC_OWNER_ID = "11b1fbc5-fb9c-48dd-8177-e9c8abdd4bdb";

export function assertScandicOwner(userId: string) {
  if (userId !== SCANDIC_OWNER_ID) throw new Error("Forbidden");
}

export function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s-]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return `+${p.slice(2)}`;
  if (p.startsWith("0")) return `+46${p.slice(1)}`;
  return `+${p}`;
}

export async function send46elksSms(to: string, message: string): Promise<{ id?: string }> {
  const username = process.env.ELKS_API_USERNAME?.trim();
  const password = process.env.ELKS_API_PASSWORD?.trim();
  const sender = process.env.ELKS_SENDER?.trim();
  if (!username || !password || !sender) throw new Error("46elks credentials are not configured");
  const body = new URLSearchParams({ from: sender, to, message });
  const auth = btoa(`${username}:${password}`);
  const res = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`46elks error [${res.status}]: ${text.slice(0, 300)}`);
  try {
    const json = JSON.parse(text);
    return { id: json.id };
  } catch {
    return {};
  }
}

export function bookingUrl(token: string): string {
  const base = (process.env.CANONICAL_APP_URL || "https://sipomax.se").replace(/\/$/, "");
  return `${base}/b/${token}`;
}

const BOOKING_NOTIFY_EMAIL = "hedisson@live.se";

export async function sendBookingNotificationEmail(info: {
  name: string;
  phone: string;
  email: string | null;
  slotStart: Date;
  meetingType: "zoom" | "meet" | "teams" | "in_person";
  question?: string | null;
}): Promise<void> {
  const OUTLOOK_KEY = process.env.MICROSOFT_OUTLOOK_API_KEY;
  if (!OUTLOOK_KEY) {
    console.error("[scandic] Booking notification skipped: MICROSOFT_OUTLOOK_API_KEY missing");
    return;
  }

  const dateStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(info.slotStart);
  const timeStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(info.slotStart);
  const typeLabel =
    info.meetingType === "zoom" ? "Zoom" :
    info.meetingType === "meet" ? "Google Meet" :
    info.meetingType === "teams" ? "Microsoft Teams" : "Fysiskt möte";

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `
    <h2>Ny bokning via ScandicReach</h2>
    <p><strong>${esc(info.name)}</strong> har bokat en genomgång.</p>
    <ul>
      <li><strong>Datum:</strong> ${esc(dateStr)}</li>
      <li><strong>Tid:</strong> ${esc(timeStr)}</li>
      <li><strong>Mötesform:</strong> ${esc(typeLabel)}</li>
      <li><strong>Telefon:</strong> ${esc(info.phone)}</li>
      <li><strong>E-post:</strong> ${info.email ? esc(info.email) : "—"}</li>
    </ul>
    ${info.question ? `<p><strong>Fråga/meddelande:</strong><br/>${esc(info.question)}</p>` : ""}
  `;

  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OUTLOOK_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: `Ny bokning: ${info.name} – ${dateStr} kl ${timeStr}`,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: BOOKING_NOTIFY_EMAIL } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[scandic] Booking notification email failed [${res.status}]: ${body.slice(0, 300)}`);
  }
}

export function composeInitialMessage(name: string | null, token: string): string {
  const greeting = name && name.trim() ? `Hej ${name.trim().split(/\s+/)[0]}!` : "Hej!";
  return `${greeting} Tack för att du visat intresse för ScandicReach. Tryck här för att boka din kostnadsfria genomgång: ${bookingUrl(token)}`;
}

export function composeReminderMessage(name: string | null, token: string, kind: "3h" | "next_day" | "4d"): string {
  const greeting = name && name.trim() ? `Hej ${name.trim().split(/\s+/)[0]}!` : "Hej!";
  const link = bookingUrl(token);
  if (kind === "3h") return `${greeting} Glöm inte att boka din tid med ScandicReach. Tryck här för att välja en tid: ${link}`;
  if (kind === "next_day") return `${greeting} En liten påminnelse – tryck här för att boka en kort genomgång: ${link}`;
  return `${greeting} Är du fortfarande intresserad av ScandicReach? Tryck här för att boka: ${link}`;
}

export function composeManualBookingMessage(
  name: string | null,
  token: string,
  start: Date,
  meetingType: "zoom" | "meet" | "teams" | "in_person",
): string {
  const greeting = name && name.trim() ? `Hej ${name.trim().split(/\s+/)[0]}!` : "Hej!";
  const dateStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(start);
  const timeStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  const typeLabel =
    meetingType === "zoom" ? "via Zoom" :
    meetingType === "meet" ? "via Google Meet" :
    meetingType === "teams" ? "via Microsoft Teams" : "fysiskt möte";
  return `${greeting} Tack för att du visat intresse för ScandicReach. Vi har bokat in en genomgång ${dateStr} kl ${timeStr} (${typeLabel}). Tryck här för att se bokningen och lägga till den i din kalender: ${bookingUrl(token)}`;
}

// Working hours: Mon-Fri 07:00 - 18:00, 30 min slots, Europe/Stockholm
export const WORK_START_HOUR = 7;
export const WORK_END_HOUR = 18;
export const SLOT_MINUTES = 30;

// Strategic free windows (always kept free for the customer): 09:00-11:00 and 14:00-16:00
function isStrategicSlot(hour: number, minute: number): boolean {
  const h = hour + minute / 60;
  return (h >= 9 && h < 11) || (h >= 14 && h < 16);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Returns ISO date strings (yyyy-mm-dd) for fake-busy slot start times in Europe/Stockholm local time
export function fakeBusyKeysForDate(dateKey: string): Set<string> {
  const slots: Array<{ h: number; m: number }> = [];
  for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      if (isStrategicSlot(h, m)) continue;
      slots.push({ h, m });
    }
  }
  const seed = hashString(dateKey);
  const indices: number[] = [];
  for (let i = 0; i < slots.length; i++) indices.push(i);
  // simple seeded shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const r = ((hashString(dateKey + ":" + i) ^ seed) >>> 0) % (i + 1);
    [indices[i], indices[r]] = [indices[r], indices[i]];
  }
  const picked = indices.slice(0, 5);
  const set = new Set<string>();
  for (const idx of picked) {
    const s = slots[idx];
    set.add(`${dateKey} ${String(s.h).padStart(2, "0")}:${String(s.m).padStart(2, "0")}`);
  }
  return set;
}

// Build day slots in Stockholm local time for a given local date (yyyy-mm-dd).
// Returns each slot as { localKey: "yyyy-mm-dd HH:MM", isoStart: ISO UTC string }.
export function buildDaySlots(dateKey: string): Array<{ localKey: string; isoStart: string; isoEnd: string; hour: number; minute: number }> {
  // dateKey is treated as Europe/Stockholm local date.
  // We construct each slot's ISO by computing the UTC instant of that local wall time.
  const out: Array<{ localKey: string; isoStart: string; isoEnd: string; hour: number; minute: number }> = [];
  const [y, m, d] = dateKey.split("-").map(Number);
  for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h++) {
    for (let min = 0; min < 60; min += SLOT_MINUTES) {
      const isoStart = stockholmWallToUtcIso(y, m, d, h, min);
      const endMin = min + SLOT_MINUTES;
      const isoEnd = endMin >= 60 ? stockholmWallToUtcIso(y, m, d, h + 1, endMin - 60) : stockholmWallToUtcIso(y, m, d, h, endMin);
      out.push({
        localKey: `${dateKey} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
        isoStart,
        isoEnd,
        hour: h,
        minute: min,
      });
    }
  }
  return out;
}

// Convert a Stockholm-local wall-clock time to a UTC ISO string.
// Handles DST by inverting the offset reported by Intl for the resulting instant.
export function stockholmWallToUtcIso(y: number, m: number, d: number, hour: number, minute: number): string {
  // Naive UTC guess for that wall time
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  // Determine Stockholm offset at that moment
  const offsetMin = stockholmOffsetMinutes(new Date(guess));
  return new Date(guess - offsetMin * 60_000).toISOString();
}

export function stockholmOffsetMinutes(date: Date): number {
  // Format the given UTC date in Stockholm and compute the difference
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUTC - date.getTime()) / 60_000);
}

export function stockholmDateKey(date: Date): string {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return dtf.format(date); // sv-SE → yyyy-mm-dd
}

export function stockholmHour(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit", hour12: false,
  });
  return Number(dtf.format(date));
}

export function isWeekendDateKey(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Build a UTC noon instant for that local date; weekday of Stockholm equals that of UTC noon (safe)
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return dow === 0 || dow === 6;
}

// ===== Reminder runner =====

export async function runScandicReminders() {
  const now = new Date();
  const nowMs = now.getTime();
  const sthHour = stockholmHour(now);

  const { data: leads, error } = await supabaseAdmin
    .from("scandic_leads")
    .select("id, name, booking_token, initial_sent_at, last_reminder_kind, status, opted_out, phone")
    .eq("status", "pending")
    .eq("opted_out", false);
  if (error) throw new Error(error.message);

  // Safety net: never remind anyone who already has a booking (e.g. a manual
  // booking made by the admin), even if the lead status is out of sync.
  const leadIds = (leads ?? []).map((l) => l.id);
  const bookedLeadIds = new Set<string>();
  if (leadIds.length > 0) {
    const { data: bookings } = await supabaseAdmin
      .from("scandic_bookings")
      .select("lead_id")
      .in("lead_id", leadIds);
    for (const b of bookings ?? []) bookedLeadIds.add(b.lead_id);
  }

  let sent = 0;
  for (const lead of leads ?? []) {
    if (bookedLeadIds.has(lead.id)) continue;
    if (!lead.initial_sent_at) continue;
    const initMs = new Date(lead.initial_sent_at).getTime();
    const ageHours = (nowMs - initMs) / 3_600_000;
    let nextKind: "3h" | "next_day" | "4d" | null = null;

    const last = lead.last_reminder_kind;
    if (!last && ageHours >= 3) {
      nextKind = "3h";
    } else if ((last === "3h" || (!last && ageHours >= 24)) && ageHours >= 24 && sthHour === 14) {
      nextKind = "next_day";
    } else if ((last === "next_day" || last === "3h" || !last) && ageHours >= 96) {
      nextKind = "4d";
    }
    if (!nextKind) continue;
    // Skip if already sent that kind
    if (last === nextKind) continue;

    const message = composeReminderMessage(lead.name, lead.booking_token, nextKind);
    try {
      const r = await send46elksSms(lead.phone, message);
      await supabaseAdmin.from("scandic_messages").insert({
        lead_id: lead.id,
        direction: "out",
        body: message,
        reminder_kind: nextKind,
        elks_id: r.id ?? null,
      });
      await supabaseAdmin.from("scandic_leads").update({ last_reminder_kind: nextKind }).eq("id", lead.id);
      sent++;
    } catch (e) {
      console.error("scandic reminder failed", lead.id, e);
    }
  }
  return { sent, considered: leads?.length ?? 0 };
}