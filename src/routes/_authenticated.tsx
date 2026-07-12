import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  Link,
  useRouterState,
} from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut, Plus, BarChart3, Send, Menu, ChevronDown, Check, ShieldAlert } from "lucide-react";
import { SipomaxLogo } from "@/components/SipomaxLogo";
import { Toaster } from "@/components/ui/sonner";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getNewInsightsCount, getImpersonationStatusFn, generateImpersonationOtpFn } from "@/lib/profile.functions";
import { isScandicOwner } from "@/lib/scandic.functions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DEV_SESSION_KEY } from "@/lib/impersonation-client";

export const Route = createFileRoute("/_authenticated")({
  // Don't SSR the protected subtree — the Supabase session lives in the
  // browser, so SSR has no bearer token and every server fn 401s.
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const fetchNewInsights = useServerFn(getNewInsightsCount);
  // Mirror the ScandicReach page's own server-side authorization so the nav
  // link is shown to every authorized owner, not just one hardcoded email.
  const checkScandicOwner = useServerFn(isScandicOwner);
  const { data: scandicGate } = useQuery({
    queryKey: ["scandic-owner"],
    queryFn: () => checkScandicOwner(),
    enabled: !!user,
  });
  const isScandicUser = scandicGate?.allowed ?? false;
  const fetchImpersonation = useServerFn(getImpersonationStatusFn);
  const generateOtp = useServerFn(generateImpersonationOtpFn);

  const { data: insightsCount } = useQuery({
    queryKey: ["new-insights-count"],
    queryFn: () => fetchNewInsights(),
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const newInsights = insightsCount?.total ?? 0;
  const hasNew = newInsights > 0 && !pathname.startsWith("/insights");

  // Read saved dev session from localStorage (written when switching to another account)
  type DevSession = { access_token: string; refresh_token: string; allUsers: Array<{ id: string; email: string }> };
  const [savedDev, setSavedDev] = useState<DevSession | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(DEV_SESSION_KEY);
      return raw ? (JSON.parse(raw) as DevSession) : null;
    } catch { return null; }
  });
  const isImpersonating = !!savedDev;

  // Fetch all users from server when logged in as the real dev account
  const impersonationQuery = useQuery({
    queryKey: ["impersonation-status"],
    queryFn: () => fetchImpersonation(),
    enabled: !!user && !isImpersonating,
  });
  const isDeveloper = isImpersonating || (impersonationQuery.data?.isDeveloper ?? false);
  const allUsers: Array<{ id: string; email: string }> = isImpersonating
    ? (savedDev?.allUsers ?? [])
    : (impersonationQuery.data?.allUsers ?? []);

  // If localStorage has stale data but the current Supabase session is actually hedisson's,
  // clear the stale entry so the UI doesn't get stuck in "impersonating" mode.
  useEffect(() => {
    if (!savedDev || !user) return;
    // If the stored dev access_token's sub matches the current user, we're already hedisson → clear
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!session) return;
      try {
        const payload = JSON.parse(atob(session.access_token.split(".")[1]));
        const savedPayload = JSON.parse(atob(savedDev.access_token.split(".")[1]));
        if (payload.sub === savedPayload.sub) {
          // Current session IS the saved dev session — we've already returned, clear stale data
          localStorage.removeItem(DEV_SESSION_KEY);
          setSavedDev(null);
        }
      } catch { /* ignore parse errors */ }
    });
  }, [savedDev, user]);

  async function restoreDevSession() {
    if (!savedDev) return;
    setSwitching(true);
    try {
      const { error } = await supabase.auth.setSession({
        access_token: savedDev.access_token,
        refresh_token: savedDev.refresh_token,
      });
      if (error) throw error;
    } catch {
      // Even if restoring fails, clear stale localStorage so user isn't stuck
    } finally {
      localStorage.removeItem(DEV_SESSION_KEY);
      setSavedDev(null);
      window.location.href = "/";
    }
  }

  async function switchToAccount(targetEmail: string) {
    if (targetEmail === user?.email || switching) return;
    setSwitching(true);
    try {
      // Always keep track of the real dev session (the original hedisson session)
      const devSessionToSave: Pick<DevSession, "access_token" | "refresh_token"> = isImpersonating && savedDev
        ? { access_token: savedDev.access_token, refresh_token: savedDev.refresh_token }
        : await supabase.auth.getSession().then(({ data }) => ({
            access_token: data.session?.access_token ?? "",
            refresh_token: data.session?.refresh_token ?? "",
          }));
      const usersToSave = isImpersonating && savedDev ? savedDev.allUsers : allUsers;

      // If currently impersonating, first restore dev session so server fn uses hedisson's JWT
      if (isImpersonating && savedDev) {
        await supabase.auth.setSession({
          access_token: savedDev.access_token,
          refresh_token: savedDev.refresh_token,
        });
      }

      // Server generates a one-time OTP for the target user (requires developer JWT)
      const { email, otp } = await generateOtp({ data: { email: targetEmail } });

      // Exchange OTP for a real Supabase session client-side — no redirect needed
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      });
      if (verifyError) throw new Error(verifyError.message);
      if (!verifyData.session) throw new Error("Fick ingen session efter OTP-verifiering.");

      // Persist the dev session so we can get back
      const newSavedDev: DevSession = { ...devSessionToSave, allUsers: usersToSave };
      localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(newSavedDev));
      setSavedDev(newSavedDev);

      window.location.href = "/";
    } catch (err: any) {
      // On failure, ensure we're back to a clean state
      const { data } = await supabase.auth.getSession();
      if (!data.session && savedDev) {
        // Restore dev session if we lost it
        await supabase.auth.setSession({ access_token: savedDev.access_token, refresh_token: savedDev.refresh_token }).catch(() => {});
      }
      // Import toast lazily to avoid circular deps
      const { toast } = await import("sonner");
      toast.error(`Kontobyte misslyckades: ${err?.message ?? "Okänt fel"}`);
      setSwitching(false);
    }
  }

  async function signOut() {
    localStorage.removeItem(DEV_SESSION_KEY);
    await supabase.auth.signOut();
    // Skip the view transition across the auth boundary — it would freeze a
    // snapshot of the app mid-teardown and can leave the login page rendered
    // off-center until a reflow. A plain swap lands on a cleanly centered login.
    navigate({ to: "/login", viewTransition: false });
  }

  const navLinks: {
    to: string;
    label: string;
    matches: (p: string) => boolean;
    icon?: React.ReactNode;
  }[] = [
    {
      to: "/dashboard",
      label: "Jobb",
      matches: (p) => p === "/dashboard" || p.startsWith("/jobs"),
    },
    { to: "/customers", label: "Kunder", matches: (p) => p.startsWith("/customers") },
    {
      to: "/insights",
      label: "Insikter",
      matches: (p) => p.startsWith("/insights"),
      icon: <BarChart3 className="h-3.5 w-3.5" />,
    },
    { to: "/settings", label: "Inställningar", matches: (p) => p.startsWith("/settings") },
    ...(isScandicUser
      ? [
          {
            to: "/scandic",
            label: "ScandicReach",
            matches: (p: string) => p.startsWith("/scandic"),
            icon: <Send className="h-3.5 w-3.5" />,
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen flex flex-col w-full bg-background">
      {/* view-transition-name lifts the header out of the `root` snapshot so it
          stays perfectly still while the page body slides beneath it. */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10" style={{ paddingTop: "env(safe-area-inset-top)", viewTransitionName: "site-header" }}>
        <div className="max-w-7xl mx-auto h-14 flex items-center px-4 sm:px-6 lg:px-8 gap-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden -ml-2"
                aria-label="Öppna meny"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle className="flex items-center gap-2 text-base">
                  <SipomaxLogo className="h-7 w-7" />
                  Sipomax
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col p-2 text-sm">
                {navLinks.map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    onClick={() => setMobileNavOpen(false)}
                    className={`px-3 py-2.5 rounded-md transition-colors inline-flex items-center gap-2 ${
                      l.to === "/insights" && hasNew
                        ? "bg-emerald-500/15 border border-emerald-500 text-emerald-700 font-medium"
                        : l.matches(pathname)
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    {l.icon}
                    {l.label}
                    {l.to === "/insights" && hasNew && (
                      <span className="ml-auto rounded-full bg-emerald-600 text-white text-[10px] font-semibold px-1.5 py-0.5">
                        {newInsights} nya
                      </span>
                    )}
                  </Link>
                ))}
                <Link
                  to="/new-job"
                  search={{ customerNumber: "", customerName: "", customerCompanyName: "", customerPhone: "", customerEmail: "", customerOrgNumber: "", billingAddress: "", billingPostalCode: "", billingCity: "" }}
                  onClick={() => setMobileNavOpen(false)}
                  className="mt-2 px-3 py-2.5 rounded-md bg-primary text-primary-foreground font-medium inline-flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" /> Nytt jobb
                </Link>
                {user?.email && (
                  <div className="mt-4 px-3 py-2 text-xs text-muted-foreground border-t flex items-center justify-between">
                    <span>{user.email}</span>
                    <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                      <LogOut className="h-3.5 w-3.5" /> Logga ut
                    </button>
                  </div>
                )}
              </nav>
            </SheetContent>
          </Sheet>
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
            <SipomaxLogo className="h-7 w-7" />
            <span className="text-sm hidden sm:inline">Sipomax</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <Link
              to="/dashboard"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                pathname === "/dashboard" || pathname.startsWith("/jobs")
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              Jobb
            </Link>
            <Link
              to="/customers"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                pathname.startsWith("/customers")
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              Kunder
            </Link>
            <Link
              to="/insights"
              className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1 ${
                hasNew
                  ? "bg-emerald-500/15 border border-emerald-500 text-emerald-700 font-medium"
                  : pathname.startsWith("/insights")
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" /> Insikter
              {hasNew && (
                <span className="ml-1 rounded-full bg-emerald-600 text-white text-[10px] font-semibold px-1.5 py-0.5">
                  {newInsights} nya
                </span>
              )}
            </Link>
            <Link
              to="/settings"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                pathname.startsWith("/settings")
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              Inställningar
            </Link>
            {isScandicUser && (
              <Link
                to="/scandic"
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1 ${
                  pathname.startsWith("/scandic")
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Send className="h-3.5 w-3.5" /> ScandicReach
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {isDeveloper && allUsers.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button disabled={switching} className={`hidden md:inline-flex items-center gap-1 text-sm rounded px-2 py-0.5 transition-colors ${isImpersonating ? "text-amber-600 font-medium bg-amber-500/10 border border-amber-500/40" : "text-muted-foreground hover:text-foreground"}`}>
                    {user?.email}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto w-64">
                  {allUsers.map((u) => {
                    const isActive = u.email === user?.email;
                    return (
                      <DropdownMenuItem
                        key={u.id}
                        onClick={() => isActive ? undefined : switchToAccount(u.email)}
                        disabled={switching || isActive}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Check className={`h-4 w-4 flex-shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate flex-1">{u.email}</span>
                      </DropdownMenuItem>
                    );
                  })}
                  {isImpersonating && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={restoreDevSession}
                        disabled={switching}
                        className="cursor-pointer font-medium"
                      >
                        <Check className="h-4 w-4 opacity-0 flex-shrink-0" />
                        Tillbaka till eget konto
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-sm text-muted-foreground hidden md:inline">{user?.email}</span>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" /> Logga ut
            </Button>
          </div>
        </div>
      </header>
      {isImpersonating && (
        <div
          role="alert"
          className="sticky top-14 z-20 flex items-center justify-center gap-3 border-b border-amber-600 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950"
          style={{ top: "calc(3.5rem + env(safe-area-inset-top))", viewTransitionName: "app-banner" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Du agerar som <span className="underline underline-offset-2">{user?.email}</span> — inte ditt eget konto
          </span>
          <button
            type="button"
            onClick={restoreDevSession}
            disabled={switching}
            className="rounded bg-amber-950 px-2 py-0.5 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
          >
            Avsluta
          </button>
        </div>
      )}
      {/* No view-transition-name here: the page body is part of the `root`
          snapshot the navigation animation slides (see styles.css). */}
      <main className="flex-1">
        <Outlet />
      </main>
      <PushNotificationPrompt />
      <Toaster />
    </div>
  );
}
