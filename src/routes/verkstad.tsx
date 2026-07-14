import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardList, LogOut, MessageSquare, Settings } from "lucide-react";
import { useEffect } from "react";
import {
  AccountSwitcherDropdown,
  ImpersonationBanner,
  useAccountSwitcher,
} from "@/components/AccountSwitcher";
import { SipomaxLogo } from "@/components/SipomaxLogo";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { DEV_SESSION_KEY } from "@/lib/impersonation-client";
import { getMyAccountInfo } from "@/lib/shop-orders.functions";

export const Route = createFileRoute("/verkstad")({
  // Ingen SSR — Supabase-sessionen finns bara i webbläsaren.
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  component: WorkshopLayout,
});

const NAV_ITEMS = [
  { to: "/verkstad", label: "Beställningar", icon: ClipboardList, exact: true },
  { to: "/verkstad/statistik", label: "Statistik", icon: BarChart3, exact: false },
  { to: "/verkstad/chatt", label: "Chatt", icon: MessageSquare, exact: false },
  { to: "/verkstad/installningar", label: "Inställningar", icon: Settings, exact: false },
] as const;

function WorkshopLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const switcher = useAccountSwitcher();

  const fetchAccountInfo = useServerFn(getMyAccountInfo);
  const { data: accountInfo } = useQuery({
    queryKey: ["my-account-info"],
    queryFn: () => fetchAccountInfo(),
    enabled: !!user,
  });

  // Kundkonton hör hemma i butiken, inte i verkstadsvyn.
  useEffect(() => {
    if (accountInfo?.accountType === "customer") {
      navigate({ to: "/", replace: true });
    }
  }, [accountInfo, navigate]);

  async function signOut() {
    localStorage.removeItem(DEV_SESSION_KEY);
    await supabase.auth.signOut();
    navigate({ to: "/login", viewTransition: false });
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-neutral-100 shadow-xl">
        <header
          className="sticky top-0 z-20 bg-gradient-to-b from-primary to-red-700 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-primary-foreground"
          style={{ viewTransitionName: "site-header" }}
        >
          <div className="flex items-center gap-2">
            <SipomaxLogo className="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-extrabold italic tracking-[0.14em]">
                SIPOMAX
              </p>
              <p className="text-[11px] text-primary-foreground/80">
                Verkstad · {accountInfo?.displayName || user?.email || ""}
              </p>
            </div>
            <AccountSwitcherDropdown
              switcher={switcher}
              className="!text-primary-foreground/90 hover:!text-primary-foreground"
            />
            <button
              type="button"
              onClick={signOut}
              aria-label="Logga ut"
              className="flex h-9 w-9 items-center justify-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/15"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        <ImpersonationBanner switcher={switcher} />
        <main className="flex-1 pb-24">
          <Outlet />
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-30">
          <div className="mx-auto w-full max-w-3xl border-t border-border bg-card px-2 pb-[calc(env(safe-area-inset-bottom)+0.25rem)]">
            <div className="flex">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex flex-1 flex-col items-center gap-1 py-2 text-muted-foreground transition-colors"
                  activeProps={{ className: "text-primary" }}
                  activeOptions={{ exact: item.exact }}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-[11px] font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <Toaster />
      </div>
    </div>
  );
}
