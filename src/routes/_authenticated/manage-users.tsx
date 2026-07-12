import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, Search, Upload, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { getAiPromptSettings } from "@/lib/profile.functions";
import {
  getUserManagement,
  adminGetUserSettings,
  adminUpdateUserSettings,
  adminUploadInvoiceLogo,
} from "@/lib/users.functions";
import {
  ProfileSettingsFields,
  EMPTY_PROFILE_FORM,
  profileToForm,
  type ProfileForm,
} from "@/components/ProfileSettingsFields";

interface BankDetails {
  bankgiro: string;
  plusgiro: string;
  iban: string;
  clearingNumber: string;
  accountNumber: string;
  paymentNote: string;
}

const EMPTY_BANK: BankDetails = { bankgiro: "", plusgiro: "", iban: "", clearingNumber: "", accountNumber: "", paymentNote: "" };

export const Route = createFileRoute("/_authenticated/manage-users")({
  component: ManageUsersPage,
});

function ManageUsersPage() {
  useScrollTopOnMount();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchUsers = useServerFn(getUserManagement);
  const fetchAiSettings = useServerFn(getAiPromptSettings);
  const loadSettings = useServerFn(adminGetUserSettings);
  const saveSettings = useServerFn(adminUpdateUserSettings);
  const uploadLogo = useServerFn(adminUploadInvoiceLogo);

  const usersQuery = useQuery({ queryKey: ["user-management"], queryFn: () => fetchUsers() });
  const aiSettingsQuery = useQuery({ queryKey: ["ai-prompt-settings"], queryFn: () => fetchAiSettings() });

  const [email, setEmail] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [target, setTarget] = useState<{ user_id: string; email: string | null } | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE_FORM);
  const [oppEnabled, setOppEnabled] = useState(true);
  const [campEnabled, setCampEnabled] = useState(true);
  const [invoiceLogo, setInvoiceLogo] = useState<string | null>(null);
  const [invoiceAccent, setInvoiceAccent] = useState("#1a56db");
  const [bankDetails, setBankDetails] = useState<BankDetails>(EMPTY_BANK);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = usersQuery.data?.isAdmin ?? false;

  // Server fns also assert admin, but redirect non-admins out of the UI too.
  useEffect(() => {
    if (usersQuery.data && !usersQuery.data.isAdmin) {
      navigate({ to: "/settings" });
    }
  }, [usersQuery.data, navigate]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredUsers = useMemo(() => {
    const q = email.trim().toLowerCase();
    if (!q) return [];
    return (usersQuery.data?.users ?? []).filter(
      (u) =>
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.display_name ?? "").toLowerCase().includes(q),
    ).slice(0, 8);
  }, [email, usersQuery.data?.users]);

  const update = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }));

  const loadMutation = useMutation({
    mutationFn: (em: string) => loadSettings({ data: { email: em } }),
    onSuccess: (res) => {
      setTarget({ user_id: res.user_id, email: res.email });
      setForm(profileToForm(res.profile));
      setOppEnabled(res.flags.opportunities_enabled);
      setCampEnabled(res.flags.campaigns_enabled);
      const is = res.invoiceSettings;
      setInvoiceLogo(is.invoice_logo_url ?? null);
      setInvoiceAccent(is.invoice_accent_color ?? "#1a56db");
      const bd = is.invoice_bank_details as any;
      setBankDetails({
        bankgiro: bd?.bankgiro ?? "",
        plusgiro: bd?.plusgiro ?? "",
        iban: bd?.iban ?? "",
        clearingNumber: bd?.clearingNumber ?? "",
        accountNumber: bd?.accountNumber ?? "",
        paymentNote: bd?.paymentNote ?? "",
      });
      toast.success(`Inställningar laddade för ${res.email ?? "användaren"}`);
    },
    onError: (e: any) => {
      setTarget(null);
      toast.error(e?.message ?? "Kunde inte ladda användaren");
    },
  });

  const logoUploadMutation = useMutation({
    mutationFn: ({ file }: { file: File }) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(",")[1];
            const res = await uploadLogo({
              data: {
                user_id: target!.user_id,
                file_base64: base64,
                file_type: file.type as any,
              },
            });
            resolve(res.url);
          } catch (e: any) {
            reject(e);
          }
        };
        reader.onerror = () => reject(new Error("Kunde inte läsa filen"));
        reader.readAsDataURL(file);
      }),
    onSuccess: (url) => {
      setInvoiceLogo(url);
      toast.success("Logotyp uppladdad");
    },
    onError: (e: any) => toast.error(e?.message ?? "Uppladdning misslyckades"),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          user_id: target!.user_id,
          patch: {
            ...form,
            opportunities_enabled: oppEnabled,
            campaigns_enabled: campEnabled,
            invoice_logo_url: invoiceLogo ?? null,
            invoice_accent_color: invoiceAccent,
            invoice_bank_details: {
              clearingNumber: bankDetails.clearingNumber || null,
              accountNumber: bankDetails.accountNumber || null,
              bankgiro: bankDetails.bankgiro || null,
              plusgiro: bankDetails.plusgiro || null,
              iban: bankDetails.iban || null,
              paymentNote: bankDetails.paymentNote || null,
            },
          },
        },
      }),
    onSuccess: () => {
      toast.success("Användarens inställningar sparade");
      // If the admin edited their own account, refresh their own gated UI.
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunde inte spara"),
  });

  function selectUser(userEmail: string) {
    setEmail(userEmail);
    setDropdownOpen(false);
    loadMutation.mutate(userEmail);
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (!em) return;
    setDropdownOpen(false);
    loadMutation.mutate(em);
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    saveMutation.mutate();
  }

  if (!isAdmin) {
    return (
      <main className="max-w-3xl mx-auto p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Laddar…</p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <Link
        to="/settings"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="h-4 w-4" /> Tillbaka till inställningar
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Hantera användare</h1>
        <p className="text-sm text-muted-foreground">
          Sök upp en användare via e-postadress och redigera deras inställningar. Integrationer (Visma/Fortnox)
          måste användaren själv ansluta.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sök användare</CardTitle>
          <CardDescription>Ange e-postadressen till kontot du vill redigera.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSearch} className="flex gap-2 items-end">
            <div className="flex-1 relative" ref={searchBoxRef}>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); setDropdownOpen(true); }}
                onFocus={() => { if (email.trim()) setDropdownOpen(true); }}
                placeholder="namn@verkstaden.se"
                autoComplete="off"
              />
              {dropdownOpen && filteredUsers.length > 0 && (
                <div className="absolute z-30 mt-1 w-full rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                  <ul className="divide-y">
                    {filteredUsers.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); selectUser(u.email ?? ""); }}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors"
                        >
                          <p className="text-sm font-medium truncate">{u.email}</p>
                          {u.display_name && (
                            <p className="text-xs text-muted-foreground truncate">{u.display_name}</p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <Button type="submit" disabled={loadMutation.isPending}>
              {loadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Ladda
            </Button>
          </form>
        </CardContent>
      </Card>

      {target && (
        <form onSubmit={onSave} className="space-y-6">
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-4 py-3">
            <Badge variant="secondary">Redigerar</Badge>
            <span className="text-sm font-medium truncate">{target.email}</span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Funktioner</CardTitle>
              <CardDescription>Aktivera eller inaktivera sidor och knappar för den här användaren.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Uppföljningar</p>
                  <p className="text-xs text-muted-foreground">Visa sidan och knappen för uppföljningar.</p>
                </div>
                <Switch checked={oppEnabled} onCheckedChange={setOppEnabled} aria-label="Uppföljningar" />
              </div>
              <Separator />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Kampanjer</p>
                  <p className="text-xs text-muted-foreground">Visa sidan och knappen för kampanjer.</p>
                </div>
                <Switch checked={campEnabled} onCheckedChange={setCampEnabled} aria-label="Kampanjer" />
              </div>
            </CardContent>
          </Card>

          <ProfileSettingsFields
            form={form}
            update={update}
            aiSettings={aiSettingsQuery.data}
            showAiPrompts
            featureFlags={{ opportunities_enabled: oppEnabled, campaigns_enabled: campEnabled }}
          />

          {/* Invoice PDF settings */}
          <Card>
            <CardHeader>
              <CardTitle>Faktura-PDF-inställningar</CardTitle>
              <CardDescription>
                Logotyp, färg och betalningsuppgifter som visas på användarens genererade PDF-fakturor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Logo */}
              <div className="space-y-2">
                <Label>Logotyp</Label>
                {invoiceLogo ? (
                  <div className="flex items-center gap-3">
                    <img src={invoiceLogo} alt="Logo" className="h-12 max-w-[160px] object-contain border rounded p-1 bg-white" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setInvoiceLogo(null)}
                    >
                      <X className="h-4 w-4 mr-1" /> Ta bort
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ingen logotyp uppladdad.</p>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) logoUploadMutation.mutate({ file });
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={logoUploadMutation.isPending || !target}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {logoUploadMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Ladda upp logotyp
                </Button>
              </div>

              <Separator />

              {/* Accent color */}
              <div className="flex items-center gap-3">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="accentColor">Accentfärg</Label>
                  <p className="text-xs text-muted-foreground">Används i rubriker och tabellhuvud i PDF-fakturan.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="accentColor"
                    type="color"
                    value={invoiceAccent}
                    onChange={(e) => setInvoiceAccent(e.target.value)}
                    className="h-9 w-14 rounded border cursor-pointer"
                  />
                  <span className="text-sm font-mono text-muted-foreground">{invoiceAccent}</span>
                </div>
              </div>

              <Separator />

              {/* Bank details */}
              <div className="space-y-4">
                <p className="text-sm font-medium">Betalningsuppgifter</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="clearingNumber">Clearingnr</Label>
                    <Input
                      id="clearingNumber"
                      value={bankDetails.clearingNumber}
                      onChange={(e) => setBankDetails((b) => ({ ...b, clearingNumber: e.target.value }))}
                      placeholder="3300"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="accountNumber">Kontonr</Label>
                    <Input
                      id="accountNumber"
                      value={bankDetails.accountNumber}
                      onChange={(e) => setBankDetails((b) => ({ ...b, accountNumber: e.target.value }))}
                      placeholder="9812225713"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bankgiro">Bankgiro</Label>
                    <Input
                      id="bankgiro"
                      value={bankDetails.bankgiro}
                      onChange={(e) => setBankDetails((b) => ({ ...b, bankgiro: e.target.value }))}
                      placeholder="123-4567"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="plusgiro">Plusgiro</Label>
                    <Input
                      id="plusgiro"
                      value={bankDetails.plusgiro}
                      onChange={(e) => setBankDetails((b) => ({ ...b, plusgiro: e.target.value }))}
                      placeholder="12 34 56-7"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="iban">IBAN</Label>
                    <Input
                      id="iban"
                      value={bankDetails.iban}
                      onChange={(e) => setBankDetails((b) => ({ ...b, iban: e.target.value }))}
                      placeholder="SE35 5000 0000 0549 1000 0003"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="paymentNote">Betalningsmeddelande</Label>
                    <Input
                      id="paymentNote"
                      value={bankDetails.paymentNote}
                      onChange={(e) => setBankDetails((b) => ({ ...b, paymentNote: e.target.value }))}
                      placeholder="Ange fakturanummer vid betalning"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Spara användarens inställningar
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
