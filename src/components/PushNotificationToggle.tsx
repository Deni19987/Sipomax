import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { getVapidPublicKey, getPushDeveloperStatus } from "@/lib/push.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  enablePushForCurrentDevice,
  isPushSupported,
  registerPushServiceWorker,
} from "@/lib/push.device";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PushNotificationToggle() {
  const fetchKey = useServerFn(getVapidPublicKey);
  const fetchDevStatus = useServerFn(getPushDeveloperStatus);

  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDeveloper, setIsDeveloper] = useState(false);

  const isIosPwa =
    typeof window !== "undefined" &&
    // navigator.standalone is set by iOS Safari in standalone/PWA mode
    (("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches) &&
    /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      if (!isPushSupported()) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      try {
        const reg = await registerPushServiceWorker();
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch (e) {
        console.error(e);
        setState("off");
      }
      try {
        const { isDeveloper: dev } = await fetchDevStatus();
        setIsDeveloper(dev);
      } catch {
        // non-critical
      }
    })();
  }, []);

  async function enable() {
    console.info("[push] activate clicked", {
      permission: Notification.permission,
      isSecureContext: window.isSecureContext,
      serviceWorker: "serviceWorker" in navigator,
      pushManager: "PushManager" in window,
    });
    try {
      setBusy(true);
      setStatusMessage("Öppnar rutan för notistillstånd...");
      await enablePushForCurrentDevice(fetchKey);
      setState("on");
      setStatusMessage("Push-notiser är aktiverade på den här enheten.");
      toast.success("Push-notiser aktiverade");
    } catch (e: unknown) {
      console.error(e);
      if (Notification.permission === "denied") setState("denied");
      setStatusMessage(getErrorMessage(e, "Kunde inte aktivera notiser"));
      toast.error(getErrorMessage(e, "Kunde inte aktivera notiser"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setStatusMessage("Push-notiser är avstängda på den här enheten.");
      toast.success("Push-notiser avstängda");
    } catch (e: unknown) {
      console.error("[push] disable failed", e);
      setStatusMessage(getErrorMessage(e, "Kunde inte stänga av"));
      toast.error(getErrorMessage(e, "Kunde inte stänga av"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    console.info("[push] test clicked");
    setBusy(true);
    setStatusMessage("Skickar testnotis...");
    try {
      if (Notification.permission !== "granted") {
        throw new Error("Webbläsaren har inte gett tillstånd för notiser på den här sidan");
      }
      const reg = await registerPushServiceWorker();
      if (!isIosPwa) {
        // Local notifications don't work on iOS PWA — skip and rely on the server push instead
        const localNotificationOptions: NotificationOptions = {
          body: "Lokal testnotis fungerar 🎉",
          icon: "/icon-512.png",
          badge: "/icon-512.png",
          tag: "vh-local-test",
          data: { url: "/dashboard" },
        };
        await reg.showNotification("Testnotis", localNotificationOptions);
        console.info("[push] local notification shown");
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Du behöver logga in igen innan testnotis kan skickas");
      const response = await fetch("/api/push-test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await response.json().catch(() => null);
      console.info("[push] test response", {
        ok: response.ok,
        status: response.status,
        result: res,
      });
      if (!response.ok) throw new Error(res?.error || "Misslyckades");
      const sent = res?.sent ?? 0;
      const total = res?.total ?? 0;
      const errs: string[] = Array.isArray(res?.errors) ? res.errors : [];
      if (sent > 0) {
        const iosNote = isIosPwa
          ? " Stäng appen nu – notisen visas bara när appen är i bakgrunden."
          : "";
        setStatusMessage(
          `Testnotis skickad till ${sent}/${total} enhet${total === 1 ? "" : "er"}.${iosNote}` +
            (errs.length ? ` Fel: ${errs.join(" | ")}` : ""),
        );
        toast.success(`Testnotis skickad (${sent}/${total})`);
      } else {
        const detail = errs.length ? errs.join(" | ") : "Inga prenumerationer hittades för kontot.";
        setStatusMessage(`Ingen notis skickades. ${detail}`);
        toast.error("Push misslyckades — se status nedan");
      }
    } catch (e: unknown) {
      console.error("[push] test failed", e);
      setStatusMessage(getErrorMessage(e, "Misslyckades"));
      toast.error(getErrorMessage(e, "Misslyckades"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTestToAll() {
    setBusy(true);
    setStatusMessage("Skickar testnotis till alla konton...");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Du behöver logga in igen");
      const response = await fetch("/api/push-test?all=1", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await response.json().catch(() => null);
      if (!response.ok) throw new Error(res?.error || "Misslyckades");
      const { sent, total, accounts, errors: errs } = res ?? {};
      setStatusMessage(
        `Skickad till ${sent}/${total} enheter på ${accounts ?? "?"} konton.` +
          (errs?.length ? ` Fel: ${(errs as string[]).join(" | ")}` : ""),
      );
      toast.success(`Broadcast skickad (${sent}/${total})`);
    } catch (e: unknown) {
      const msg = getErrorMessage(e, "Misslyckades");
      setStatusMessage(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Kontrollerar...
      </div>
    );
  }
  if (state === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground">
        Den här webbläsaren stödjer inte push-notiser. På iPhone: lägg först till sidan på
        hemskärmen, öppna PWA:n och aktivera notiser därifrån.
      </p>
    );
  }
  if (state === "denied") {
    return (
      <p className="text-sm text-destructive">
        Notiser är blockerade. Tillåt dem i webbläsarens / iPhones inställningar för sidan och ladda
        om.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {state === "off" ? (
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              void enable();
            }}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Bell className="h-4 w-4 mr-2" />
            )}
            Aktivera push-notiser
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                void disable();
              }}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <BellOff className="h-4 w-4 mr-2" />
              )}
              Stäng av
            </Button>
            {isDeveloper && (
              <Button
                type="button"
                variant="secondary"
                onClick={(event) => {
                  event.preventDefault();
                  void sendTest();
                }}
                disabled={busy}
              >
                Skicka testnotis
              </Button>
            )}
            {isDeveloper && (
              <Button
                type="button"
                variant="destructive"
                onClick={(event) => {
                  event.preventDefault();
                  void sendTestToAll();
                }}
                disabled={busy}
              >
                Skicka till alla konton
              </Button>
            )}
          </>
        )}
      </div>
      {statusMessage ? <p className="text-xs text-muted-foreground">{statusMessage}</p> : null}
      {isIosPwa && (
        <p className="text-xs text-muted-foreground">
          På iPhone visas notiser bara när appen är stängd eller i bakgrunden.
        </p>
      )}
    </div>
  );
}
