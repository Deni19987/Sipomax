import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function getVapidKeys() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) throw new Error("VAPID keys missing");
  return { subject: subj, publicKey: pub, privateKey: priv };
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendPushToUser(userId: string, payload: PushPayload) {
  console.info("[push] sendPushToUser start", { userId, title: payload.title });
  let vapid;
  try {
    vapid = getVapidKeys();
  } catch (e) {
    console.error("[push] VAPID config missing", e);
    return { sent: 0, removed: 0, total: 0, errors: ["VAPID keys missing on server"] };
  }
  const [subsResult, profileResult] = await Promise.all([
    supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_agent")
      .eq("user_id", userId),
    supabaseAdmin
      .from("profiles")
      .select("notify_mobile_push, notify_desktop_push")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (subsResult.error) {
    console.error("[push] failed to load subscriptions", subsResult.error.message);
    return { sent: 0, removed: 0, total: 0, errors: [subsResult.error.message] };
  }
  const allSubs = subsResult.data ?? [];
  const notifyMobile = profileResult.data?.notify_mobile_push ?? true;
  const notifyDesktop = profileResult.data?.notify_desktop_push ?? true;
  const mobileRe = /Mobi|Android|iPhone|iPad|iPod/i;
  const subs = allSubs.filter((s) => {
    const ua: string = (s as any).user_agent ?? "";
    const isMobile = mobileRe.test(ua);
    return isMobile ? notifyMobile : notifyDesktop;
  });
  console.info("[push] subscriptions loaded", { userId, total: allSubs.length, filtered: subs.length });
  if (allSubs.length === 0) {
    return { sent: 0, removed: 0, total: 0, errors: ["Inga sparade push-prenumerationer för användaren"] };
  }
  if (subs.length === 0) {
    return { sent: 0, removed: 0, total: allSubs.length, errors: [] };
  }

  let sent = 0;
  let removed = 0;
  const errors: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const endpointPreview = s.endpoint.slice(0, 60);
      try {
        const subscription: PushSubscription = {
          endpoint: s.endpoint,
          expirationTime: null,
          keys: { p256dh: s.p256dh, auth: s.auth },
        };
        // NOTE: do not pass `topic` here — Apple Web Push rejects topics
        // longer than 32 chars / non-base64url with BadWebPushTopic (400).
        // The notification grouping `tag` is handled inside the SW payload.
        const request = await buildPushPayload(
          { data: payload, options: { ttl: 86400, urgency: "high" } },
          subscription,
          vapid,
        );
        const bodyBuffer = new Uint8Array(request.body).buffer;
        const res = await fetch(s.endpoint, {
          method: request.method.toUpperCase(),
          headers: request.headers,
          body: bodyBuffer,
        });
        const bodyText = res.ok ? "" : await res.text().catch(() => "");
        console.info("[push] fetch result", {
          endpoint: endpointPreview,
          status: res.status,
          ok: res.ok,
          body: bodyText.slice(0, 200),
        });
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) {
            await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
            removed++;
            errors.push(`${endpointPreview}: ${res.status} subscription removed`);
          } else {
            errors.push(`${endpointPreview}: ${res.status} ${bodyText.slice(0, 120)}`);
          }
          return;
        }
        sent++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[push] send threw", endpointPreview, message);
        errors.push(`${endpointPreview}: ${message}`);
      }
    }),
  );
  console.info("[push] sendPushToUser done", { userId, sent, removed, total: allSubs.length, errors });
  return { sent, removed, total: allSubs.length, errors };
}

// Fan a notification out to every account in a workshop — the owner plus all
// invited team members (profiles whose account_owner_id points at the owner).
// Each account's own device/mobile/desktop preferences are still respected
// inside sendPushToUser, so a member who muted push simply gets nothing.
export async function sendPushToWorkshop(workshopId: string, payload: PushPayload) {
  const { data: members, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .or(`id.eq.${workshopId},account_owner_id.eq.${workshopId}`);
  if (error) {
    console.error("[push] failed to load workshop members", error.message);
  }
  const ids = new Set<string>((members ?? []).map((m) => m.id));
  ids.add(workshopId); // always include the owner, even if the row query failed
  console.info("[push] sendPushToWorkshop", { workshopId, accounts: ids.size });

  const results = await Promise.all([...ids].map((id) => sendPushToUser(id, payload)));
  return results.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      removed: acc.removed + r.removed,
      total: acc.total + r.total,
      errors: [...acc.errors, ...r.errors],
    }),
    { sent: 0, removed: 0, total: 0, errors: [] as string[] },
  );
}