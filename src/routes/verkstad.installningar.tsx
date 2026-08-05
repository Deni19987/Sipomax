import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Receipt, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { getProfile, updateProfile } from "@/lib/profile.functions";
import {
  disconnectShopFortnoxFn,
  getShopFortnoxAuthorizeUrlFn,
  getShopFortnoxStatusFn,
  importFortnoxArticlesFn,
} from "@/lib/shop-fortnox.functions";
import { getMyAccountInfo } from "@/lib/shop-orders.functions";
import { deleteUser, getUserManagement, inviteUser } from "@/lib/users.functions";

export const Route = createFileRoute("/verkstad/installningar")({
  ssr: false,
  // Fortnox-callbacken skickar tillbaka hit: ?connected=fortnox när det gick
  // vägen, ?error=... när Fortnox avvisade försöket.
  validateSearch: z.object({ connected: z.string().optional(), error: z.string().optional() }),
  component: WorkshopSettingsPage,
});

function WorkshopSettingsPage() {
  const { user } = useAuth();
  const fetchAccountInfo = useServerFn(getMyAccountInfo);
  const { data: accountInfo } = useQuery({
    queryKey: ["my-account-info"],
    queryFn: () => fetchAccountInfo(),
    enabled: !!user,
  });

  return (
    <div className="space-y-4 px-4 pt-4 lg:pt-8">
      <h1 className="text-lg font-bold text-foreground lg:text-2xl">Inställningar</h1>
      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
        <WorkshopProfileCard />
        <FortnoxCard />
        <TeamCard isDeveloper={accountInfo?.isDeveloper ?? false} />
      </div>
    </div>
  );
}

function WorkshopProfileCard() {
  const fetchProfile = useServerFn(getProfile);
  const saveProfile = useServerFn(updateProfile);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["workshop-profile"],
    queryFn: () => fetchProfile(),
  });

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    if (!data?.profile) return;
    setName(data.profile.display_name ?? "");
    setCompanyName(data.profile.company_name ?? "");
    setPhone(data.profile.contact_phone ?? "");
  }, [data]);

  const mutation = useMutation({
    mutationFn: () =>
      saveProfile({
        data: { display_name: name, company_name: companyName, contact_phone: phone },
      }),
    onSuccess: () => {
      toast.success("Inställningarna sparades.");
      queryClient.invalidateQueries({ queryKey: ["workshop-profile"] });
      queryClient.invalidateQueries({ queryKey: ["my-account-info"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Kunde inte spara inställningarna."),
  });

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-card-foreground">
        <Building2 className="h-4 w-4 text-primary" /> Verkstadsprofil
      </h2>
      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ws-name" className="text-xs">
            Visningsnamn
          </Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-company" className="text-xs">
            Företagsnamn
          </Label>
          <Input
            id="ws-company"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-phone" className="text-xs">
            Telefon
          </Label>
          <Input id="ws-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="w-full rounded-full"
        >
          {mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Spara
        </Button>
      </div>
    </div>
  );
}

/**
 * Fortnox-kopplingen för butiken.
 *
 * Anslutningen gör tre saker, i den ordningen: den importerar Fortnox
 * artikelregister till appens produkter (en gång), speglar därefter nya och
 * ändrade produkter till Fortnox, och skapar automatiskt fakturan när en order
 * markeras som levererad.
 */
function FortnoxCard() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getShopFortnoxStatusFn);
  const getAuthorizeUrl = useServerFn(getShopFortnoxAuthorizeUrlFn);
  const disconnect = useServerFn(disconnectShopFortnoxFn);
  const importArticles = useServerFn(importFortnoxArticlesFn);
  const [connecting, setConnecting] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["shop-fortnox-status"],
    queryFn: () => fetchStatus(),
  });

  const importMutation = useMutation({
    mutationFn: () => importArticles(),
    onSuccess: (result) => {
      if (!result.alreadyDone) {
        toast.success(
          result.imported > 0
            ? `${result.imported} artiklar importerades från Fortnox.`
            : "Inga nya artiklar att importera från Fortnox.",
        );
      }
      queryClient.invalidateQueries({ queryKey: ["shop-fortnox-status"] });
      queryClient.invalidateQueries({ queryKey: ["workshop-products"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Artiklarna kunde inte importeras."),
  });

  // Den initiala importen körs så fort en anslutning finns men importen ännu
  // inte är gjord — oavsett om man just kom tillbaka från Fortnox eller
  // öppnar sidan senare.
  const needsImport = !!status?.connected && !status.articleImportAt;
  useEffect(() => {
    if (needsImport && !importMutation.isPending && !importMutation.isError) {
      importMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsImport]);

  useEffect(() => {
    if (search.connected === "fortnox") toast.success("Fortnox anslutet.");
    // Felet från Fortnox visas i klartext — "invalid_scope: An unsupported
    // scope was requested" pekar direkt på vad som saknas i integrationen,
    // vilket en tyst omdirigering aldrig hade gjort.
    if (search.error) {
      toast.error(`Fortnox nekade anslutningen: ${search.error}`, { duration: 12_000 });
    }
  }, [search.connected, search.error]);

  const disconnectMutation = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => {
      toast.success("Fortnox frånkopplat.");
      queryClient.invalidateQueries({ queryKey: ["shop-fortnox-status"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Fortnox kunde inte kopplas från."),
  });

  async function connect() {
    setConnecting(true);
    try {
      const { url } = await getAuthorizeUrl();
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anslutningen kunde inte startas.");
      setConnecting(false);
    }
  }

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-card-foreground">
        <Receipt className="h-4 w-4 text-primary" /> Fortnox
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        När en order markeras som levererad skapas och bokförs fakturan automatiskt i Fortnox med
        orderns alla artiklar. Så fort fakturan är betald i Fortnox blir ordern avklarad.
      </p>

      {isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Hämtar status…</p>
      ) : status?.connected ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-sm font-semibold text-card-foreground">Anslutet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {importMutation.isPending
                ? "Importerar artiklar från Fortnox…"
                : status.articleImportAt
                  ? `Artiklar importerade ${new Date(status.articleImportAt).toLocaleDateString("sv-SE")}. Nya produkter skapas härifrån och synkas till Fortnox.`
                  : "Artikelimporten är inte gjord ännu."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {status.syncedProductCount} av {status.productCount} produkter är kopplade till en
              Fortnox-artikel
              {status.failedProductCount > 0
                ? ` · ${status.failedProductCount} misslyckades att synka`
                : ""}
              .
            </p>
          </div>
          {importMutation.isError && (
            <Button
              variant="outline"
              className="w-full rounded-full"
              disabled={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              Försök importera artiklarna igen
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full rounded-full"
            disabled={disconnectMutation.isPending}
            onClick={() => {
              if (window.confirm("Koppla från Fortnox? Nya ordrar kommer inte att faktureras.")) {
                disconnectMutation.mutate();
              }
            }}
          >
            {disconnectMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Koppla från Fortnox
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Vid anslutningen hämtas alla artiklar som redan finns i Fortnox in som produkter i
            appen. Därefter skapas nya produkter bara här — artiklar som läggs upp direkt i Fortnox
            syns inte i appen.
          </p>
          <Button onClick={connect} disabled={connecting} className="w-full rounded-full">
            {connecting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Anslut Fortnox
          </Button>
        </div>
      )}
    </div>
  );
}

function TeamCard({ isDeveloper }: { isDeveloper: boolean }) {
  const fetchManagement = useServerFn(getUserManagement);
  const invite = useServerFn(inviteUser);
  const removeUser = useServerFn(deleteUser);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["user-management"],
    queryFn: () => fetchManagement(),
  });

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  const inviteMutation = useMutation({
    mutationFn: () =>
      invite({
        data: {
          email: email.trim(),
          display_name: displayName.trim() || null,
          origin: typeof window !== "undefined" ? window.location.origin : null,
        },
      }),
    onSuccess: () => {
      toast.success(`Inbjudan skickad till ${email.trim()}.`);
      setEmail("");
      setDisplayName("");
      queryClient.invalidateQueries({ queryKey: ["user-management"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Inbjudan kunde inte skickas."),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => removeUser({ data: { user_id: userId } }),
    onSuccess: () => {
      toast.success("Användaren togs bort.");
      queryClient.invalidateQueries({ queryKey: ["user-management"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Användaren kunde inte tas bort."),
  });

  if (!data?.isAdmin) return null;

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-card-foreground">
        <UsersRound className="h-4 w-4 text-primary" />
        {isDeveloper ? "Verkstäder & användare" : "Medarbetare"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {isDeveloper
          ? "Varje person du bjuder in blir en egen fristående verkstad med egen data. Verkstäder kan i sin tur bjuda in medarbetare till sitt eget konto."
          : "Personer du bjuder in blir medarbetare i din verkstad och delar verkstadens beställningar, statistik och chatt."}
      </p>

      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim() && !inviteMutation.isPending) inviteMutation.mutate();
        }}
      >
        <Input
          type="email"
          required
          placeholder="E-postadress"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          placeholder="Namn (valfritt)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Button
          type="submit"
          disabled={inviteMutation.isPending || !email.trim()}
          className="w-full rounded-full"
        >
          {inviteMutation.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="mr-1 h-4 w-4" />
          )}
          {isDeveloper ? "Bjud in ny verkstad" : "Bjud in medarbetare"}
        </Button>
      </form>

      <div className="mt-4 space-y-2">
        {(data.users ?? []).map((member) => (
          <div key={member.id} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-card-foreground">
                {member.display_name || member.email}
              </p>
              <p className="truncate text-xs text-muted-foreground">{member.email}</p>
            </div>
            {member.pending && (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                Inbjuden
              </span>
            )}
            {member.id !== data.selfId && (
              <button
                type="button"
                aria-label={`Ta bort ${member.email}`}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm(`Ta bort ${member.email}?`)) {
                    deleteMutation.mutate(member.id);
                  }
                }}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
