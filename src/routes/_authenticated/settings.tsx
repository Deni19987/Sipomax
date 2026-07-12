import { createFileRoute, Link } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  Save,
  SlidersHorizontal,
  Trash2,
  Unplug,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { disconnectFortnoxFn, getFortnoxAuthorizeUrl, getFortnoxStatus } from "@/lib/fortnox.functions";
import { isImpersonatingNow } from "@/lib/impersonation-client";
import {
  getProfile,
  updateProfile,
  getAiPromptSettings,
  getImpersonationStatusFn,
} from "@/lib/profile.functions";
import { getUserManagement, inviteUser, deleteUser } from "@/lib/users.functions";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import {
  ProfileSettingsFields,
  EMPTY_PROFILE_FORM,
  profileToForm,
  Field,
  type ProfileForm,
} from "@/components/ProfileSettingsFields";

// Payment details shown in the invoice footer, stored as JSON on the profile.
type BankForm = {
  bankgiro: string;
  plusgiro: string;
  iban: string;
  clearingNumber: string;
  accountNumber: string;
  paymentNote: string;
};
const EMPTY_BANK: BankForm = { bankgiro: "", plusgiro: "", iban: "", clearingNumber: "", accountNumber: "", paymentNote: "" };

export const Route = createFileRoute("/_authenticated/settings")({
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.prefetchQuery({ queryKey: ["profile"], queryFn: () => getProfile() }),
      queryClient.prefetchQuery({ queryKey: ["user-management"], queryFn: () => getUserManagement() }),
      queryClient.prefetchQuery({ queryKey: ["impersonation-status"], queryFn: () => getImpersonationStatusFn() }),
      queryClient.prefetchQuery({ queryKey: ["fortnox-status"], queryFn: () => getFortnoxStatus() }),
      queryClient.prefetchQuery({ queryKey: ["ai-prompt-settings"], queryFn: () => getAiPromptSettings() }),
    ]);
  },
  component: SettingsPage,
});

function SettingsPage() {
  useScrollTopOnMount();
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getProfile);
  const saveProfile = useServerFn(updateProfile);
  const fetchAiSettings = useServerFn(getAiPromptSettings);
  const fetchImpersonation = useServerFn(getImpersonationStatusFn);
  const fetchFortnox = useServerFn(getFortnoxStatus);
  const getFortnoxUrl = useServerFn(getFortnoxAuthorizeUrl);
  const disconnectFortnox = useServerFn(disconnectFortnoxFn);
  const fetchUsers = useServerFn(getUserManagement);
  const sendInvite = useServerFn(inviteUser);
  const removeUser = useServerFn(deleteUser);

  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE_FORM);
  const [bank, setBank] = useState<BankForm>(EMPTY_BANK);
  const [fortnoxLoading, setFortnoxLoading] = useState(false);
  // Connecting/disconnecting an accounting integration while impersonating would
  // wire it to the wrong workshop. Block it outright and tell the user to return
  // to their own account first. (Read once on mount — impersonation only changes
  // via a full reload.)
  const [impersonating] = useState(() => isImpersonatingNow());
  const INTEGRATION_BLOCKED_MSG =
    "Du agerar som ett annat konto. Avsluta och gå tillbaka till ditt eget konto innan du ändrar integrationer.";
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [selfFlags, setSelfFlags] = useState({ opportunities_enabled: true, campaigns_enabled: true });

  const stale = 60_000;
  const profileQuery = useQuery({ queryKey: ["profile"], queryFn: () => fetchProfile(), staleTime: stale });
  const fortnoxQuery = useQuery({ queryKey: ["fortnox-status"], queryFn: () => fetchFortnox(), staleTime: stale });
  const aiSettingsQuery = useQuery({ queryKey: ["ai-prompt-settings"], queryFn: () => fetchAiSettings(), staleTime: stale });
  const usersQuery = useQuery({ queryKey: ["user-management"], queryFn: () => fetchUsers(), staleTime: stale });
  const impersonationQuery = useQuery({ queryKey: ["impersonation-status"], queryFn: () => fetchImpersonation(), staleTime: stale });
  const isAdmin = usersQuery.data?.isAdmin ?? false;
  const isDeveloper = impersonationQuery.data?.isDeveloper ?? false;
  const { flags: loadedFlags, isLoading: flagsLoading } = useFeatureFlags();
  const flagsSeeded = useRef(false);

  useEffect(() => {
    if (profileQuery.data?.profile) {
      setForm(profileToForm(profileQuery.data.profile));
      const bd = (profileQuery.data.profile as any).invoice_bank_details ?? {};
      setBank({
        bankgiro: bd.bankgiro ?? "",
        plusgiro: bd.plusgiro ?? "",
        iban: bd.iban ?? "",
        clearingNumber: bd.clearingNumber ?? "",
        accountNumber: bd.accountNumber ?? "",
        paymentNote: bd.paymentNote ?? "",
      });
    }
  }, [profileQuery.data]);

  // Seed the admin's own feature toggles once, then leave them under user control.
  useEffect(() => {
    if (!flagsLoading && !flagsSeeded.current) {
      setSelfFlags({
        opportunities_enabled: loadedFlags.opportunities_enabled,
        campaigns_enabled: loadedFlags.campaigns_enabled,
      });
      flagsSeeded.current = true;
    }
  }, [flagsLoading, loadedFlags]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected === "fortnox") toast.success("Fortnox ansluten");
    const err = params.get("error");
    if (err) toast.error(`Integrationsfel: ${err}`);
    if (params.size) {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const update = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }));

  const saveMutation = useMutation({
    mutationFn: (data: Partial<ProfileForm> & { opportunities_enabled?: boolean; campaigns_enabled?: boolean; invoice_bank_details?: BankForm }) =>
      saveProfile({ data }),
    onSuccess: () => {
      toast.success("Inställningar sparade");
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunde inte spara"),
  });

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    // The feature-flag toggles only render for the developer, so only send them
    // in that case.
    saveMutation.mutate({ ...form, ...(isDeveloper ? selfFlags : {}), invoice_bank_details: bank });
  };

  const inviteMutation = useMutation({
    mutationFn: (vars: { email: string; display_name: string }) =>
      sendInvite({
        data: {
          email: vars.email,
          display_name: vars.display_name || undefined,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Inbjudan skickad. Användaren får ett mejl med en länk för att skapa sitt lösenord.");
      setInviteEmail("");
      setInviteName("");
      qc.invalidateQueries({ queryKey: ["user-management"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunde inte skicka inbjudan"),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => removeUser({ data: { user_id: userId } }),
    onSuccess: () => {
      toast.success("Användaren togs bort");
      qc.invalidateQueries({ queryKey: ["user-management"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunde inte ta bort användaren"),
  });

  function onInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    inviteMutation.mutate({ email, display_name: inviteName.trim() });
  }

  function onDeleteUser(userId: string, label: string) {
    if (!confirm(`Ta bort ${label}? Användaren förlorar omedelbart åtkomst till plattformen.`)) return;
    deleteUserMutation.mutate(userId);
  }

  async function connectFortnox() {
    if (isImpersonatingNow()) { toast.error(INTEGRATION_BLOCKED_MSG); return; }
    setFortnoxLoading(true);
    try {
      const res = await getFortnoxUrl({ data: { origin: window.location.origin } });
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = res.url;
        } else {
          window.location.href = res.url;
        }
      } catch {
        window.open(res.url, "_blank", "noopener,noreferrer");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Kunde inte starta Fortnox-anslutning");
      setFortnoxLoading(false);
    }
  }

  async function onDisconnectFortnox() {
    if (isImpersonatingNow()) { toast.error(INTEGRATION_BLOCKED_MSG); return; }
    if (!confirm("Koppla från Fortnox? Schemalagda fakturor kommer att misslyckas tills du återansluter.")) return;
    try {
      await disconnectFortnox({});
      toast.success("Fortnox frånkopplad");
      qc.invalidateQueries({ queryKey: ["fortnox-status"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Kunde inte koppla från");
    }
  }

  const fortnoxStatus = fortnoxQuery.data;
  const managedUsers = usersQuery.data?.users ?? [];
  const selfId = usersQuery.data?.selfId;
  const aiSettings = aiSettingsQuery.data;

  return (
    <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Tillbaka
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Inställningar</h1>
        <p className="text-sm text-muted-foreground">Anpassa verkstadens profil, fakturering och integrationer.</p>
      </div>

      {(isAdmin || usersQuery.isLoading) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" /> Användare
            </CardTitle>
            <CardDescription>
              Bjud in nya användare till plattformen. De får ett mejl med en länk där de skapar sitt eget
              lösenord och aktiverar kontot. Det här är det enda sättet att lägga till användare.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={onInvite} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <Field label="E-postadress">
                <Input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="namn@verkstaden.se"
                />
              </Field>
              <Field label="Namn (valfritt)">
                <Input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="För- och efternamn"
                />
              </Field>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-2" />
                )}
                Skicka inbjudan
              </Button>
            </form>

            <Separator />

            <div className="space-y-2">
              {usersQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Laddar användare…</p>
              ) : managedUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Inga användare ännu.</p>
              ) : (
                managedUsers.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {u.display_name || u.email || "Okänd användare"}
                      </p>
                      {u.display_name && u.email && (
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {u.pending ? (
                        <Badge variant="outline">Inbjuden – väntar</Badge>
                      ) : (
                        <Badge variant="secondary">Aktiv</Badge>
                      )}
                      {u.id === selfId ? (
                        <Badge variant="outline">Du</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Ta bort användare"
                          onClick={() => onDeleteUser(u.id, u.email || u.display_name || "användaren")}
                          disabled={deleteUserMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

          </CardContent>
        </Card>
      )}

      {!impersonationQuery.isLoading && isDeveloper && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="h-5 w-5" /> Hantera användares inställningar
            </CardTitle>
            <CardDescription>
              Öppna en annan användares konto via e-postadress och redigera deras profil, fakturering, SMS,
              notiser och AI — samt aktivera/inaktivera sidorna Uppföljningar och Kampanjer för dem.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/manage-users">
                Hantera användare <ChevronRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <form onSubmit={onSave} className="space-y-6">
        {!impersonationQuery.isLoading && isDeveloper && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5" /> Funktioner
              </CardTitle>
              <CardDescription>
                Aktivera eller inaktivera sidorna Uppföljningar och Kampanjer för ditt eget konto. Den här
                inställningen visas bara för dig som plattformsadministratör.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Uppföljningar</p>
                  <p className="text-xs text-muted-foreground">Visa sidan och knappen för uppföljningar.</p>
                </div>
                <Switch
                  checked={selfFlags.opportunities_enabled}
                  onCheckedChange={(v) => setSelfFlags((f) => ({ ...f, opportunities_enabled: v }))}
                  aria-label="Uppföljningar"
                />
              </div>
              <Separator />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Kampanjer</p>
                  <p className="text-xs text-muted-foreground">Visa sidan och knappen för kampanjer.</p>
                </div>
                <Switch
                  checked={selfFlags.campaigns_enabled}
                  onCheckedChange={(v) => setSelfFlags((f) => ({ ...f, campaigns_enabled: v }))}
                  aria-label="Kampanjer"
                />
              </div>
            </CardContent>
          </Card>
        )}

        <ProfileSettingsFields
          form={form}
          update={update}
          aiSettings={aiSettings}
          showDeviceNotifications
          allowDeveloperBasePrompt
          showAiPrompts={isDeveloper}
          featureFlags={loadedFlags}
          invoiceBank={bank}
          onInvoiceBankChange={(patch) => setBank((b) => ({ ...b, ...patch }))}
        />

        <div className="flex justify-end">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Spara inställningar
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Fortnox</CardTitle>
          <CardDescription>
            Anslut ditt Fortnox-konto för att skapa fakturor. Fakturor skapas och bokförs i Fortnox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fortnoxQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Laddar…</p>
          ) : fortnoxStatus?.connected ? (
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  Ansluten <Badge variant="outline">Produktion</Badge>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fakturor skapas i Fortnox — du granskar och bokför dem därifrån.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onDisconnectFortnox} disabled={impersonating}>
                  <Unplug className="h-4 w-4 mr-1.5" /> Koppla från
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={connectFortnox} disabled={fortnoxLoading || impersonating}>
              {fortnoxLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-2" />}
              Anslut Fortnox-konto
            </Button>
          )}
          {impersonating && (
            <p className="text-xs font-medium text-amber-600">{INTEGRATION_BLOCKED_MSG}</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
