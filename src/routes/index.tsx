import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  // Keep ssr: false so no server-side redirect occurs, which avoids
  // a server/client hydration mismatch (React error #418).
  ssr: false,
  component: Index,
});

// Capture the URL at module load, before Supabase's detectSessionInUrl can clear
// the hash. If Supabase's redirect_to falls back to the Site URL ("/") instead of
// "/login", the recovery/invite tokens land here — we forward them to /login with
// the hash + query intact rather than bouncing to the dashboard and losing them.
const _initialHash = typeof window !== "undefined" ? window.location.hash : "";
const _initialSearch = typeof window !== "undefined" ? window.location.search : "";

function isAuthLanding(): boolean {
  const hash = new URLSearchParams(_initialHash.replace(/^#/, ""));
  const type = hash.get("type");
  const hasHashTokens = !!hash.get("access_token") && (type === "recovery" || type === "invite");
  const hasCode = new URLSearchParams(_initialSearch).has("code");
  return hasHashTokens || hasCode;
}

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    if (isAuthLanding()) {
      // Hard redirect so the hash + query survive and login.tsx can capture them.
      window.location.replace(`/login${_initialSearch}${_initialHash}`);
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }, [navigate]);
  return null;
}
