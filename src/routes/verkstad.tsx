import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardList, LogOut, MessageSquare, Settings, Tag } from "lucide-react";
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
import {
  cacheAccountType,
  clearAccountType,
  readCachedAccountType,
  resolveAccountType,
} from "@/lib/account-landing";
import { DEV_SESSION_KEY } from "@/lib/impersonation-client";
import { getMyAccountInfo } from "@/lib/shop-orders.functions";

export const Route = createFileRoute("/verkstad")({
  // Ingen SSR — Supabase-sessionen finns bara i webbläsaren.
  ssr: false,
  // Kundkonton hör hemma i butiken. Precis som "/" tas beslutet före render,
  // så att verkstadsskalet aldrig hinner ritas för fel konto.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    const cached = readCachedAccountType();
    if (cached === "customer") throw redirect({ to: "/" });
    if (cached === "workshop") {
      void resolveAccountType(true); // verifiera i bakgrunden
      return;
    }
    if ((await resolveAccountType()) === "customer") throw redirect({ to: "/" });
  },
  component: WorkshopLayout,
});

const NAV_ITEMS = [
  { to: "/verkstad", label: "Ordrar", icon: ClipboardList, exact: true },
  { to: "/verkstad/produkter", label: "Produkter", icon: Tag, exact: false },
  { to: "/verkstad/statistik", label: "Statistik", icon: BarChart3, exact: false },
  { to: "/verkstad/chatt", label: "Chatt", icon: MessageSquare, exact: false },
  { to: "/verkstad/installningar", label: "Mer", icon: Settings, exact: false },
] as const;

/**
 * Verkstadens skal i två lägen:
 * - under `lg`: mobilskal med röd header och fast bottennavigering.
 * - från `lg`: desktopskal med fast sidomeny till vänster och innehållet i
 *   full bredd (centrerat först på riktigt breda skärmar).
 */
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

  // Skyddsnät för kontobyten under sessionen, och facit för landningscachen.
  useEffect(() => {
    if (!accountInfo) return;
    cacheAccountType(accountInfo.accountType);
    if (accountInfo.accountType === "customer") {
      navigate({ to: "/", replace: true });
    }
  }, [accountInfo, navigate]);

  async function signOut() {
    localStorage.removeItem(DEV_SESSION_KEY);
    clearAccountType();
    await supabase.auth.signOut();
    navigate({ to: "/login", viewTransition: false });
  }

  const accountLabel = accountInfo?.displayName || user?.email || "";

  return (
    <div className="min-h-screen bg-neutral-100">
      {/* Sidomeny — bara desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card lg:flex">
        <div className="flex items-center gap-2 bg-gradient-to-b from-primary to-red-700 px-5 py-5 text-primary-foreground">
          <SipomaxLogo className="h-8 w-8" />
          <div className="min-w-0">
            <p className="font-display text-base font-extrabold italic tracking-[0.14em]">
              SIPOMAX
            </p>
            <p className="text-[11px] text-primary-foreground/80">Verkstad</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: "!bg-primary/10 !text-primary" }}
              activeOptions={{ exact: item.exact }}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label === "Mer" ? "Inställningar" : item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 px-1 pb-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-card-foreground">{accountLabel}</p>
              <p className="text-[11px] text-muted-foreground">Inloggad</p>
            </div>
            <AccountSwitcherDropdown switcher={switcher} />
          </div>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Logga ut
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Header — bara mobil */}
        <header
          className="sticky top-0 z-20 bg-gradient-to-b from-primary to-red-700 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-primary-foreground lg:hidden"
          style={{ viewTransitionName: "site-header" }}
        >
          <div className="flex items-center gap-2">
            <SipomaxLogo className="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-extrabold italic tracking-[0.14em]">
                SIPOMAX
              </p>
              <p className="text-[11px] text-primary-foreground/80">Verkstad · {accountLabel}</p>
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

        <main className="flex-1 pb-24 lg:pb-10">
          <div className="mx-auto w-full max-w-3xl lg:max-w-[1600px] lg:px-4">
            <Outlet />
          </div>
        </main>

        {/* Bottennavigering — bara mobil */}
        <nav className="fixed inset-x-0 bottom-0 z-30 lg:hidden">
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
