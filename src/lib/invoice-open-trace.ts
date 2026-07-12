// Temporary diagnostics for the "open invoice" flow. The symptom under
// investigation is a full page reload with no visible error — which destroys
// all client-side evidence. Every step is therefore sent to the server with
// navigator.sendBeacon (beacons are queued by the browser and survive page
// navigation/reload) and stored in client_diagnostics. Each page load gets a
// fresh session id, so a reload shows up in the trail as the session id
// changing mid-flow. Read the trail at /api/public/client-log?key=... .
// Remove the whole apparatus once the bug is solved.

const sessionId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

export function traceInvoiceOpen(step: string, detail?: unknown) {
  try {
    if (typeof navigator === "undefined") return;
    const payload = JSON.stringify({
      session: sessionId,
      entries: [
        {
          step,
          detail: detail == null ? undefined : String(detail).slice(0, 480),
        },
      ],
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/public/client-log", payload);
    } else {
      void fetch("/api/public/client-log", { method: "POST", body: payload, keepalive: true });
    }
  } catch {
    /* diagnostics must never break the app */
  }
}

// Stamp every page load and catch the errors that would otherwise vanish
// with the reload. Module side effect on purpose: it must run before any
// open-invoice click can happen.
if (typeof window !== "undefined") {
  traceInvoiceOpen(
    "page-load",
    `${location.pathname} standalone=${window.matchMedia("(display-mode: standalone)").matches}`,
  );
  window.addEventListener("error", (e) => {
    traceInvoiceOpen("window-error", `${e.message} @${e.filename?.split("/").pop()}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    traceInvoiceOpen("unhandled-rejection", (e as PromiseRejectionEvent).reason);
  });
  window.addEventListener("pagehide", () => traceInvoiceOpen("pagehide"));
}
