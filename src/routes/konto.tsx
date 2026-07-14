import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronRight,
  FileText,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Package,
  Phone,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  AccountSwitcherDropdown,
  ImpersonationBanner,
  useAccountSwitcher,
} from "@/components/AccountSwitcher";
import { ShopShell } from "@/components/shop/ShopShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { DEV_SESSION_KEY } from "@/lib/impersonation-client";
import { getMyAccountInfo } from "@/lib/shop-orders.functions";

export const Route = createFileRoute("/konto")({
  ssr: false,
  component: AccountPage,
});

function AccountPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const switcher = useAccountSwitcher();
  const fetchAccountInfo = useServerFn(getMyAccountInfo);
  const { data: accountInfo } = useQuery({
    queryKey: ["my-account-info"],
    queryFn: () => fetchAccountInfo(),
    enabled: !!user,
  });

  return (
    <ShopShell title="Konto" backTo="/">
      <ImpersonationBanner switcher={switcher} />
      <div className="space-y-4 px-4 pt-4">
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              {loading ? (
                <p className="text-sm text-muted-foreground">Laddar…</p>
              ) : user ? (
                <>
                  <p className="truncate text-sm font-bold text-card-foreground">{user.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {accountInfo?.accountType === "workshop" ? "Verkstadskonto" : "Inloggad kund"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-card-foreground">Inte inloggad</p>
                  <p className="text-xs text-muted-foreground">
                    Logga in för att koppla dina beställningar till ert kundkonto.
                  </p>
                </>
              )}
            </div>
          </div>
          {switcher.isDeveloper && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">Byt konto</span>
              <AccountSwitcherDropdown switcher={switcher} />
            </div>
          )}
          {accountInfo?.accountType === "workshop" && (
            <Link
              to="/verkstad"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-neutral-900 py-2.5 text-sm font-semibold text-white"
            >
              <Wrench className="h-4 w-4" /> Till verkstadsvyn
            </Link>
          )}
          {!loading &&
            (user ? (
              <button
                type="button"
                onClick={async () => {
                  localStorage.removeItem(DEV_SESSION_KEY);
                  await supabase.auth.signOut();
                  toast.success("Du är utloggad");
                  navigate({ to: "/login", viewTransition: false });
                }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-border py-2.5 text-sm font-semibold text-foreground"
              >
                <LogOut className="h-4 w-4" /> Logga ut
              </button>
            ) : (
              <Link
                to="/login"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
              >
                <LogIn className="h-4 w-4" /> Logga in
              </Link>
            ))}
        </div>

        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          <Link
            to="/bestallningar"
            className="flex items-center gap-3 border-b border-border p-4 transition-colors hover:bg-accent"
          >
            <Package className="h-5 w-5 text-primary" />
            <span className="flex-1 text-sm font-medium text-card-foreground">
              Mina beställningar
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <div className="flex items-center gap-3 p-4">
            <FileText className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium text-card-foreground">Fakturering</p>
              <p className="text-xs text-muted-foreground">
                Beställningar faktureras via Fortnox enligt ert avtal med Sipomax.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-card p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold text-card-foreground">
            <Building2 className="h-4 w-4 text-primary" />
            Sipomax Bilvårdsprodukter och Maskiner AB
          </h2>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" /> Regulatorvägen 21, 141 49 Huddinge
            </p>
            <a href="tel:0868455450" className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0" /> 08-684 554 50
            </a>
            <a href="mailto:kontakt@sipomax.se" className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0" /> kontakt@sipomax.se
            </a>
          </div>
        </div>
      </div>
    </ShopShell>
  );
}
