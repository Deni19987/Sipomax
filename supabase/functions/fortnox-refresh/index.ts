// Proactively refreshes Fortnox access tokens on a schedule (invoked by pg_cron
// every 5 minutes, see the accompanying migration), instead of relying on a
// live user request to rotate the token.
//
// Why this exists: Fortnox rotates (and immediately invalidates) the
// refresh_token on every use. The app's own Netlify function previously did
// this rotation inline during a user's request — and Netlify function
// execution can be frozen or killed after the outbound fetch to Fortnox has
// already been processed server-side (Fortnox rotated the token) but before
// the response reached our code to save it. That permanently wedges the
// connection; the next request gets `invalid_grant` no matter what it does.
// This confirmed in production on 2026-07-02: a token request timed out on
// our side after 8s, yet duration_ms on later attempts (15.5s, 25.5s) show
// the function was frozen well past its own abort timer.
//
// Running the rotation here instead — as a scheduled Edge Function with no
// client waiting on it — means it isn't tied to any request's lifecycle, so
// there's no "user navigated away / request tab closed" trigger to kill it
// mid-flight. As long as connections are refreshed here well before they're
// needed, `fortnoxFetch()` in the app almost never has to rotate the token
// itself; the 401-retry path there remains only as a fallback.
import { createClient } from "npm:@supabase/supabase-js@2";

const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
// Refresh anything expiring within 20 minutes — comfortably ahead of the
// app's own 10-minute proactive buffer, so the app should always see a fresh
// token by the time it needs one.
const REFRESH_WINDOW_MS = 20 * 60_000;
// Same rationale as the app's own lock TTL: must outlast this function's own
// worst-case single-connection refresh duration so a stale lock from a
// crashed run doesn't wedge the connection forever, but long enough that a
// slow-but-live run isn't preempted by the next cron tick 5 minutes later.
const LOCK_TTL_MS = 4 * 60_000;

function tokenFingerprint(token: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then((buf) =>
    Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12)
  );
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const clientId = Deno.env.get("FORTNOX_CLIENT_ID")!;
  const clientSecret = Deno.env.get("FORTNOX_CLIENT_SECRET")!;
  const basic = btoa(`${clientId}:${clientSecret}`);

  const cutoff = new Date(Date.now() + REFRESH_WINDOW_MS).toISOString();
  const { data: due, error: dueError } = await supabase
    .from("fortnox_connections")
    .select("user_id, refresh_token, expires_at")
    .lt("expires_at", cutoff);
  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500 });
  }

  const results: Array<{ userId: string; outcome: string }> = [];

  for (const conn of due ?? []) {
    const lockCutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("fortnox_connections")
      .update({ refreshing_at: new Date().toISOString() })
      .eq("user_id", conn.user_id)
      .or(`refreshing_at.is.null,refreshing_at.lt.${lockCutoff}`)
      .select("refresh_token")
      .maybeSingle();
    if (claimError || !claimed) {
      results.push({ userId: conn.user_id, outcome: claimError ? "claim-error" : "lock-held" });
      continue;
    }

    const startedAt = Date.now();
    const { data: eventRow } = await supabase
      .from("fortnox_refresh_events")
      .insert({
        user_id: conn.user_id,
        trigger_reason: "cron",
        attempt: 0,
        token_fingerprint: await tokenFingerprint(claimed.refresh_token),
        old_expires_at: conn.expires_at,
      })
      .select("id")
      .single();
    const eventId = eventRow?.id ?? null;

    try {
      const res = await fetch(FORTNOX_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: claimed.refresh_token,
        }).toString(),
      });
      const text = await res.text();
      if (!res.ok) {
        if (eventId != null) {
          await supabase.from("fortnox_refresh_events").update({
            finished_at: new Date().toISOString(),
            outcome: "token-error",
            error_status: res.status,
            error_body: text.slice(0, 500),
            duration_ms: Date.now() - startedAt,
          }).eq("id", eventId);
        }
        // A genuinely dead refresh token can't be recovered here — clear the
        // lock so the next cron tick (or a live user request) can surface
        // the reconnect message instead of finding a stuck lock.
        await supabase.from("fortnox_connections").update({ refreshing_at: null }).eq("user_id", conn.user_id);
        results.push({ userId: conn.user_id, outcome: `token-error:${res.status}` });
        continue;
      }
      const tokens = JSON.parse(text) as { access_token: string; refresh_token: string; expires_in: number };
      const { error: storeError } = await supabase.from("fortnox_connections").upsert({
        user_id: conn.user_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
        environment: "production",
        updated_at: new Date().toISOString(),
        refreshing_at: null,
      }, { onConflict: "user_id" });
      if (storeError) {
        if (eventId != null) {
          await supabase.from("fortnox_refresh_events").update({
            finished_at: new Date().toISOString(),
            outcome: "store-error",
            error_body: storeError.message.slice(0, 500),
            duration_ms: Date.now() - startedAt,
          }).eq("id", eventId);
        }
        // The token itself already rotated on Fortnox's side even though our
        // write failed — clearing the lock here (rather than waiting out the
        // TTL) lets the very next cron tick retry with whatever is now
        // actually stored, instead of sitting blocked for up to 4 minutes.
        await supabase.from("fortnox_connections").update({ refreshing_at: null }).eq("user_id", conn.user_id);
        results.push({ userId: conn.user_id, outcome: "store-error" });
        continue;
      }
      if (eventId != null) {
        await supabase.from("fortnox_refresh_events").update({
          finished_at: new Date().toISOString(),
          outcome: "success",
          duration_ms: Date.now() - startedAt,
        }).eq("id", eventId);
      }
      results.push({ userId: conn.user_id, outcome: "success" });
    } catch (err) {
      if (eventId != null) {
        await supabase.from("fortnox_refresh_events").update({
          finished_at: new Date().toISOString(),
          outcome: "token-error",
          error_body: String((err as Error)?.message ?? err).slice(0, 500),
          duration_ms: Date.now() - startedAt,
        }).eq("id", eventId);
      }
      await supabase.from("fortnox_connections").update({ refreshing_at: null }).eq("user_id", conn.user_id);
      results.push({ userId: conn.user_id, outcome: "exception" });
    }
  }

  return new Response(JSON.stringify({ ok: true, checked: (due ?? []).length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
