import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CartProvider } from "@/lib/shop/cart";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: "Sipomax" },
      {
        name: "description",
        content:
          "Beställ bilvårdsprodukter och maskiner från Sipomax — förtvätt, tvätt, polering, skydd och utrustning för biltvättar och verkstäder.",
      },
      { name: "author", content: "Lovable" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Sipomax" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "Sipomax" },
      {
        property: "og:description",
        content:
          "Beställ bilvårdsprodukter och maskiner från Sipomax — förtvätt, tvätt, polering, skydd och utrustning för biltvättar och verkstäder.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Sipomax" },
      {
        name: "twitter:description",
        content:
          "Beställ bilvårdsprodukter och maskiner från Sipomax — förtvätt, tvätt, polering, skydd och utrustning för biltvättar och verkstäder.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a151f910-270e-42e3-a156-b71615d9c2cf/id-preview-3ce54710--2eb0659c-72a5-4e51-876f-f3a047bdf057.lovable.app-1779197589836.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a151f910-270e-42e3-a156-b71615d9c2cf/id-preview-3ce54710--2eb0659c-72a5-4e51-876f-f3a047bdf057.lovable.app-1779197589836.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Captured synchronously at module load — before Supabase's async detectSessionInUrl
// can clear the hash. If a recovery/invite/PKCE landing arrives on ANY route other
// than the ones that handle it themselves (/login, /), forward it to /login with the
// hash + query intact. This is a safety net for when Supabase's Site URL fallback (or
// a misconfigured redirect_to) drops the tokens on an unexpected path like /dashboard.
const _rootAuthRedirect: string | null = (() => {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  if (path === "/login" || path === "/") return null; // handled by login.tsx / index.tsx
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = hash.get("type");
  const hasHashTokens = !!hash.get("access_token") && (type === "recovery" || type === "invite");
  const hasCode = new URLSearchParams(window.location.search).has("code");
  if (!hasHashTokens && !hasCode) return null;
  return `/login${window.location.search}${window.location.hash}`;
})();

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    if (_rootAuthRedirect) {
      window.location.replace(_rootAuthRedirect);
    }
  }, []);

  // Wipe the React Query cache whenever the signed-in user changes. The cache is
  // a single in-memory store keyed only by things like ["jobs"] / ["customers"],
  // so without this a sign-out → sign-in (which stays a client-side navigation)
  // would show the PREVIOUS account's cached rows to the next account until the
  // background refetch lands. Clearing here makes that impossible. Only a real
  // user change clears — token refreshes for the same user are left alone so we
  // don't nuke the cache (and refetch everything) periodically.
  useEffect(() => {
    let currentUserId: string | null | undefined = undefined; // unknown until first event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        currentUserId = null;
        return;
      }
      if (currentUserId !== undefined && nextUserId !== currentUserId) {
        queryClient.clear();
      }
      currentUserId = nextUserId;
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === "notification-navigate" && typeof data.url === "string") {
        try {
          router.navigate({ to: data.url });
        } catch (e) {
          window.location.href = data.url;
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <AuthGate>
          <Outlet />
        </AuthGate>
      </CartProvider>
    </QueryClientProvider>
  );
}

// Routes reachable without a session: the login screen itself and the
// public, token-scoped customer links. Everything else — the whole shop —
// requires a signed-in user.
function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/b/") ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/scandic/book")
  );
}

// A recovery/invite/PKCE landing carries tokens in the URL. Let those render
// so the page-level handlers (login.tsx / index.tsx) can forward them, rather
// than bouncing to a token-less /login and dropping the tokens.
function hasAuthTokens(): boolean {
  if (typeof window === "undefined") return false;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = hash.get("type");
  const hasHashTokens = !!hash.get("access_token") && (type === "recovery" || type === "invite");
  const hasCode = new URLSearchParams(window.location.search).has("code");
  return hasHashTokens || hasCode;
}

/**
 * Locks the app behind the login screen. Unauthenticated visitors to any
 * non-public route are redirected to /login; public routes and token landings
 * always render. While the session is still resolving we show a brand splash
 * rather than flashing protected content.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const allowed = isPublicPath(pathname) || hasAuthTokens();
  const blocked = !allowed && !loading && !user;

  useEffect(() => {
    if (blocked) navigate({ to: "/login", viewTransition: false });
  }, [blocked, navigate]);

  if (allowed || (!loading && user)) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
