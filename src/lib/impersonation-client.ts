// Single source of truth for the developer-impersonation marker.
//
// Impersonation is a *real* Supabase session swap — while acting as another
// workshop the browser genuinely holds that account's JWT, so the server cannot
// distinguish it from a normal login. The only reliable client-side signal that
// we are acting as someone other than our own account is the saved original dev
// session stored under this key (set in _authenticated.tsx when switching).
export const DEV_SESSION_KEY = "sipomax_dev_session";

// True when the current browser session is a developer impersonating another
// account. Used to hard-block account-scoped side effects (e.g. connecting an
// integration) that must never be performed against the wrong workshop by
// mistake.
export function isImpersonatingNow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.localStorage.getItem(DEV_SESSION_KEY);
  } catch {
    return false;
  }
}
