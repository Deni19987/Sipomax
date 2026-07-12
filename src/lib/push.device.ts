import { supabase } from "@/integrations/supabase/client";

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerPushServiceWorker() {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await registration.update().catch((error) => {
    console.warn("[push] service worker update check failed", error);
  });
  await navigator.serviceWorker.ready;
  return registration;
}

/**
 * Activates push notifications for the current device:
 * requests permission, subscribes via PushManager and persists the
 * subscription in Supabase. Throws on failure so callers can surface
 * the error message. Returns "granted" on success.
 */
export async function enablePushForCurrentDevice(
  fetchVapidKey: () => Promise<{ publicKey: string | null }>,
): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    throw new Error(
      perm === "denied"
        ? "Tillstånd för notiser nekades"
        : "Tillstånd för notiser krävs",
    );
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) throw new Error("Du behöver logga in igen innan push-notiser kan aktiveras");
  const reg = await registerPushServiceWorker();
  const { publicKey } = await fetchVapidKey();
  if (!publicKey) throw new Error("VAPID-nyckel saknas på servern");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = sub.toJSON();
  const userAgent = navigator.userAgent.slice(0, 500);
  const { error: deleteOldError } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", session.user.id)
    .eq("user_agent", userAgent)
    .neq("endpoint", sub.endpoint);
  if (deleteOldError) throw new Error(deleteOldError.message);
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: session.user.id,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
}
