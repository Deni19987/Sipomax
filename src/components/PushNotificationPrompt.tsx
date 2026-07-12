import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getVapidPublicKey } from "@/lib/push.functions";
import { enablePushForCurrentDevice, isPushSupported, registerPushServiceWorker } from "@/lib/push.device";

// localStorage key tracking how many times the prompt has been shown on this
// device. Once it reaches MAX_PROMPTS (or notifications get enabled) we stop.
const SHOWN_COUNT_KEY = "push_prompt_shown_count";
// sessionStorage flag so we only ever evaluate/show once per login session.
const SESSION_FLAG_KEY = "push_prompt_seen_this_session";
const MAX_PROMPTS = 2;
const DONE_SENTINEL = 99;

function getShownCount(): number {
  const raw = window.localStorage.getItem(SHOWN_COUNT_KEY);
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function setShownCount(n: number) {
  window.localStorage.setItem(SHOWN_COUNT_KEY, String(n));
}

export function PushNotificationPrompt() {
  const fetchKey = useServerFn(getVapidPublicKey);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      // Only evaluate once per session, regardless of outcome.
      if (window.sessionStorage.getItem(SESSION_FLAG_KEY)) return;
      if (!isPushSupported()) return;
      // Already decided to stop, or permission already resolved.
      if (getShownCount() >= MAX_PROMPTS) return;
      if (Notification.permission === "denied") return;
      if (Notification.permission === "granted") {
        // Permission granted — confirm an active subscription exists. If it
        // does, never prompt again. If it somehow doesn't, fall through and
        // offer to (re)enable.
        try {
          const reg = await registerPushServiceWorker();
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            setShownCount(DONE_SENTINEL);
            return;
          }
        } catch {
          // ignore — fall through to prompt
        }
      }
      if (cancelled) return;
      // Mark seen for this session and bump the persistent counter now, so a
      // dismissal (including closing the tab) still counts as one showing.
      window.sessionStorage.setItem(SESSION_FLAG_KEY, "1");
      setShownCount(getShownCount() + 1);
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setBusy(true);
    try {
      await enablePushForCurrentDevice(fetchKey);
      setShownCount(DONE_SENTINEL);
      toast.success("Push-notiser aktiverade");
      setOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Kunde inte aktivera notiser";
      toast.error(msg);
      // Leave the counter as-is; if it hasn't hit the cap they'll be asked
      // once more next login.
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function handleDismiss() {
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">Aktivera push-notiser</DialogTitle>
          <DialogDescription className="text-center">
            Få en notis direkt när en kund skickar ett meddelande eller när du har obesvarade
            uppföljningar – även när appen är stängd. Du kan stänga av det när som helst i
            inställningarna.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="button" onClick={handleEnable} disabled={busy} className="w-full">
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Bell className="mr-2 h-4 w-4" />
            )}
            Aktivera notiser
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleDismiss}
            disabled={busy}
            className="w-full"
          >
            Inte nu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
