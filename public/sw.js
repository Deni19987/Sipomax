/* Service Worker for Web Push notifications */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  console.info("[sw] push event received", { hasData: Boolean(event.data) });

  event.waitUntil(
    (async () => {
      let payload = {};
      try {
        payload = event.data ? event.data.json() : {};
      } catch (e) {
        console.warn("[sw] push payload was not JSON", e);
        payload = { title: "Nytt meddelande", body: event.data ? event.data.text() : "" };
      }

      const title = payload.title || "Nytt meddelande";
      const notificationTag =
        typeof payload.tag === "string" && payload.tag.trim()
          ? payload.tag.trim()
          : "vh-notification";
      const options = {
        body: payload.body || "",
        icon: payload.icon || "/icon-512.png",
        badge: "/icon-512.png",
        data: { url: payload.url || "/" },
        tag: notificationTag,
        // renotify is not supported in WebKit and silently breaks showNotification on iOS PWA
      };

      console.info("[sw] showing notification", { title, tag: notificationTag, options });
      try {
        await self.registration.showNotification(title, options);
        console.info("[sw] notification shown", { tag: notificationTag });
      } catch (error) {
        console.error("[sw] showNotification failed", error);
        throw error;
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer an existing window — focus it and navigate to the target URL.
      for (const client of clientList) {
        try {
          await client.focus();
          if ("navigate" in client && typeof client.navigate === "function") {
            try {
              await client.navigate(targetUrl);
            } catch (e) {
              // navigate() can fail cross-origin or on iOS; fall back to postMessage.
              client.postMessage({ type: "notification-navigate", url: targetUrl });
            }
          } else {
            client.postMessage({ type: "notification-navigate", url: targetUrl });
          }
          return;
        } catch (e) {
          console.warn("[sw] focus/navigate existing client failed", e);
        }
      }
      // No existing window — open a new one at the target URL.
      if (self.clients.openWindow) {
        try {
          await self.clients.openWindow(targetUrl);
        } catch (e) {
          console.error("[sw] openWindow failed", e);
        }
      }
    })(),
  );
});