import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Treat data as fresh for 30s so navigating between the dashboard and
        // a job card (or refocusing the tab) doesn't refetch everything. The
        // job page keeps a realtime subscription that invalidates on changes,
        // so live data still updates promptly.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Start loading a route's data as soon as the user hovers/touches a link,
    // before the click — removes the "Laddar..." flash on navigation.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Animate page changes with the browser's View Transitions API. Direction
    // is inferred from URL depth: going deeper (jobs list → a job) slides
    // forward, going shallower slides back, and same-level tab switches
    // cross-fade. The CSS lives in styles.css; browsers without the API just
    // navigate instantly (no-op).
    //
    // We deliberately don't use TanStack's `types` option here: it only runs
    // when the browser supports the (much newer, narrower-support)
    // `:active-view-transition-type()` CSS selector, and silently falls back
    // to a plain default cross-fade otherwise — which is indistinguishable
    // from "no animation" and is why desktop browsers with only base View
    // Transitions support never showed a slide. Setting a data attribute
    // ourselves only requires the base API (document.startViewTransition),
    // which has much wider support.
    defaultViewTransition: true,
  });

  // Public / auth routes (login, landing, customer-facing links) — anything not
  // behind the authenticated app shell. Navigations that touch one of these get
  // no slide (styles.css treats data-nav-transition="none" as an instant swap),
  // so signing in/out doesn't slide.
  const isPublicPath = (p?: string) =>
    !p ||
    p === "/" ||
    p.startsWith("/login") ||
    p.startsWith("/b/") ||
    p.startsWith("/c/") ||
    p.startsWith("/scandic/book");

  router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
    if (typeof document === "undefined") return;
    const fromPath = fromLocation?.pathname;
    const toPath = toLocation.pathname;
    let direction: "nav-forward" | "nav-back" | "nav-fade" | "none";
    if (isPublicPath(fromPath) || isPublicPath(toPath)) {
      direction = "none";
    } else {
      const depth = (p?: string) => (p ? p.split("/").filter(Boolean).length : 0);
      const from = depth(fromPath);
      const to = depth(toPath);
      // Deeper (list → detail) = forward, shallower = back, same depth =
      // cross-fade. What each direction looks like per device is styles.css's
      // concern (mobile: native push/pop; desktop: subtle drift).
      direction = to > from ? "nav-forward" : to < from ? "nav-back" : "nav-fade";
    }
    document.documentElement.dataset.navTransition = direction;
  });

  return router;
};
