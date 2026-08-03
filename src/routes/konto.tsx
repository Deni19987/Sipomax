import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronRight,
  FileText,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Truck,
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
import { clearAccountType } from "@/lib/account-landing";
import { DEV_SESSION_KEY } from "@/lib/impersonation-client";
import {
  clearMyDeliveryDetailsFn,
  getMyDeliveryDetailsFn,
  saveMyDeliveryDetailsFn,
} from "@/lib/shop-orders.functions";
import { getMyAccountInfo } from "@/lib/shop-orders.functions";
import {
  EMPTY_DELIVERY,
  deliveryLines,
  describeMissingFields,
  missingDeliveryFields,
  normalizeDelivery,
  type DeliveryDetails,
} from "@/lib/shop/delivery";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

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
                  clearAccountType();
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

        {user && <DeliveryCard />}

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

/** Sparade leveransuppgifter — förifyller kassan vid nästa beställning. */
function DeliveryCard() {
  const queryClient = useQueryClient();
  const fetchDelivery = useServerFn(getMyDeliveryDetailsFn);
  const saveDelivery = useServerFn(saveMyDeliveryDetailsFn);
  const clearDelivery = useServerFn(clearMyDeliveryDetailsFn);

  const { data } = useQuery({
    queryKey: ["my-delivery-details"],
    queryFn: () => fetchDelivery(),
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DeliveryDetails>(EMPTY_DELIVERY);
  useEffect(() => {
    if (data) setForm(data.details);
  }, [data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["my-delivery-details"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => saveDelivery({ data: normalizeDelivery(form) }),
    onSuccess: () => {
      toast.success("Leveransuppgifterna sparade.");
      setEditing(false);
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Uppgifterna kunde inte sparas."),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearDelivery(),
    onSuccess: () => {
      toast.success("Sparade uppgifter borttagna.");
      setEditing(false);
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Uppgifterna kunde inte tas bort."),
  });

  const lines = data ? deliveryLines(data.details) : [];

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Truck className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="flex-1 text-sm font-bold text-card-foreground">Leveransuppgifter</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 text-xs font-semibold text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
            {data?.saved ? "Ändra" : "Lägg till"}
          </button>
        )}
      </div>

      {!editing ? (
        data?.saved ? (
          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {data.details.phone && <p>{data.details.phone}</p>}
            {data.details.note && <p className="text-xs italic">”{data.details.note}”</p>}
            <p className="pt-2 text-xs text-muted-foreground">
              Fylls i automatiskt när du beställer.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Inga sparade uppgifter ännu. Fyll i dem i kassan och kryssa i ”Spara på mitt kundkort”,
            eller lägg till dem här.
          </p>
        )
      ) : (
        <div className="mt-3 space-y-2">
          <AccountField
            label="Mottagare"
            value={form.recipient}
            onChange={(v) => setForm((p) => ({ ...p, recipient: v }))}
          />
          <AccountField
            label="Gatuadress"
            value={form.street}
            onChange={(v) => setForm((p) => ({ ...p, street: v }))}
          />
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
            <AccountField
              label="Postnummer"
              value={form.postalCode}
              onChange={(v) => setForm((p) => ({ ...p, postalCode: v }))}
            />
            <AccountField
              label="Ort"
              value={form.city}
              onChange={(v) => setForm((p) => ({ ...p, city: v }))}
            />
          </div>
          <AccountField
            label="Land"
            value={form.country}
            onChange={(v) => setForm((p) => ({ ...p, country: v }))}
          />
          <AccountField
            label="Telefon vid leverans"
            value={form.phone}
            onChange={(v) => setForm((p) => ({ ...p, phone: v }))}
          />
          <AccountField
            label="Leveransinstruktion (valfritt)"
            value={form.note}
            onChange={(v) => setForm((p) => ({ ...p, note: v }))}
          />

          <div className="flex items-center gap-2 pt-1">
            {data?.saved && (
              <button
                type="button"
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-destructive"
              >
                Ta bort
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (data) setForm(data.details);
                  setEditing(false);
                }}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => {
                  const missing = missingDeliveryFields(form);
                  if (missing.length > 0) {
                    toast.error(describeMissingFields(missing));
                    return;
                  }
                  saveMutation.mutate();
                }}
                disabled={saveMutation.isPending}
                className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                Spara
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-foreground outline-none",
        )}
      />
    </div>
  );
}
