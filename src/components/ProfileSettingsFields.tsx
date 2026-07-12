import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";

// Shared profile form shape, used by both the self-settings page and the admin
// "manage users" editor so the two stay in sync.
export type ProfileForm = {
  display_name: string;
  company_name: string;
  company_zip_code: string;
  company_city: string;
  company_org_number: string;
  company_vat_number: string;
  contact_email: string;
  contact_phone: string;
  workshop_address: string;
  google_review_url: string;
  pickup_sms_enabled: boolean;
  pickup_sms_review_enabled: boolean;
  pickup_sms_review_message: string;
  sms_signature: string;
  notify_mobile_push: boolean;
  notify_desktop_push: boolean;
  opportunity_prompt_extra: string;
  service_prompt_extra: string;
  service_metrics: string[] | null; // null = use defaults
  opportunity_prompt_base: string;
  service_prompt_base: string;
  notify_customer_messages: boolean;
  notify_quote_responses: boolean;
  notify_pending_reminders: boolean;
};

export const EMPTY_PROFILE_FORM: ProfileForm = {
  display_name: "",
  company_name: "",
  company_zip_code: "",
  company_city: "",
  company_org_number: "",
  company_vat_number: "",
  contact_email: "",
  contact_phone: "",
  workshop_address: "",
  google_review_url: "",
  pickup_sms_enabled: true,
  pickup_sms_review_enabled: true,
  pickup_sms_review_message: "Tack för att du valde oss! Vi hoppas att du är nöjd med servicen. Om du har en stund över skulle det betyda mycket för oss om du delade din upplevelse i en kort Google-recension:",
  sms_signature: "",
  notify_mobile_push: true,
  notify_desktop_push: true,
  opportunity_prompt_extra: "",
  service_prompt_extra: "",
  service_metrics: null,
  opportunity_prompt_base: "",
  service_prompt_base: "",
  notify_customer_messages: true,
  notify_quote_responses: true,
  notify_pending_reminders: true,
};

// Maps a profiles row (from getProfile / adminGetUserSettings) into the form.
type ProfileRow = {
  [K in keyof ProfileForm]?: ProfileForm[K] | null;
};

export function profileToForm(p: ProfileRow): ProfileForm {
  return {
    display_name: p.display_name ?? "",
    company_name: p.company_name ?? "",
    company_zip_code: p.company_zip_code ?? "",
    company_city: p.company_city ?? "",
    company_org_number: p.company_org_number ?? "",
    company_vat_number: p.company_vat_number ?? "",
    contact_email: p.contact_email ?? "",
    contact_phone: p.contact_phone ?? "",
    workshop_address: p.workshop_address ?? "",
    google_review_url: p.google_review_url ?? "",
    pickup_sms_enabled: p.pickup_sms_enabled ?? true,
    pickup_sms_review_enabled: p.pickup_sms_review_enabled ?? true,
    pickup_sms_review_message: p.pickup_sms_review_message ?? "Tack för att du valde oss! Vi hoppas att du är nöjd med servicen. Om du har en stund över skulle det betyda mycket för oss om du delade din upplevelse i en kort Google-recension:",
    sms_signature: p.sms_signature ?? "",
    notify_mobile_push: (p as any).notify_mobile_push ?? true,
    notify_desktop_push: (p as any).notify_desktop_push ?? true,
    opportunity_prompt_extra: p.opportunity_prompt_extra ?? "",
    service_prompt_extra: p.service_prompt_extra ?? "",
    service_metrics: p.service_metrics ?? null,
    opportunity_prompt_base: p.opportunity_prompt_base ?? "",
    service_prompt_base: p.service_prompt_base ?? "",
    notify_customer_messages: p.notify_customer_messages ?? true,
    notify_quote_responses: (p as any).notify_quote_responses ?? true,
    notify_pending_reminders: p.notify_pending_reminders ?? true,
  };
}

// Invoice payment details, edited alongside the company profile. Optional —
// only the normal Settings page passes these; the admin editor manages them
// through its own dedicated section.
export type InvoiceBankForm = {
  bankgiro: string;
  plusgiro: string;
  iban: string;
  clearingNumber: string;
  accountNumber: string;
  paymentNote: string;
};

export type AiPromptSettings = {
  isDeveloper: boolean;
  opportunitiesBasePrompt: string | null;
  serviceBasePrompt: string | null;
  serviceMetrics: Array<{ key: string; label: string; description: string }>;
  defaultServiceMetricKeys: string[];
};

type Props = {
  form: ProfileForm;
  update: (patch: Partial<ProfileForm>) => void;
  aiSettings: AiPromptSettings | undefined;
  // The push subscription toggle is per-device, so only show it when editing
  // your own settings (not when an admin edits another account).
  showDeviceNotifications?: boolean;
  // The full base-prompt editor is developer-only and edits a global prompt;
  // never expose it from the admin per-account editor.
  allowDeveloperBasePrompt?: boolean;
  // The AI prompt cards are only shown to the developer / in the admin
  // per-account editor. Regular workshop users never see them.
  showAiPrompts?: boolean;
  // The workshop's enabled features. The "pending reminders" notification only
  // makes sense when follow-ups or campaigns exist, so it is hidden when both
  // are disabled.
  featureFlags?: { opportunities_enabled: boolean; campaigns_enabled: boolean };
  // Invoice payment details, shown inside the company-profile card. Only passed
  // by the normal Settings page; when omitted, the payment fields aren't shown.
  invoiceBank?: InvoiceBankForm;
  onInvoiceBankChange?: (patch: Partial<InvoiceBankForm>) => void;
};

export function ProfileSettingsFields({
  form,
  update,
  aiSettings,
  showDeviceNotifications = false,
  allowDeveloperBasePrompt = false,
  showAiPrompts = false,
  featureFlags = { opportunities_enabled: true, campaigns_enabled: true },
  invoiceBank,
  onInvoiceBankChange,
}: Props) {
  const allMetrics = aiSettings?.serviceMetrics ?? [];
  const defaultMetricKeys = aiSettings?.defaultServiceMetricKeys ?? [];
  const effectiveMetricKeys =
    form.service_metrics && form.service_metrics.length > 0
      ? new Set(form.service_metrics)
      : new Set(defaultMetricKeys);

  function toggleMetric(key: string, enabled: boolean) {
    const current = new Set(
      form.service_metrics && form.service_metrics.length > 0 ? form.service_metrics : defaultMetricKeys,
    );
    if (enabled) current.add(key);
    else current.delete(key);
    update({ service_metrics: Array.from(current) });
  }

  const isDeveloper = (allowDeveloperBasePrompt && aiSettings?.isDeveloper) ?? false;
  const oppBaseValue =
    form.opportunity_prompt_base || (isDeveloper ? aiSettings?.opportunitiesBasePrompt ?? "" : "");
  const svcBaseValue =
    form.service_prompt_base || (isDeveloper ? aiSettings?.serviceBasePrompt ?? "" : "");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Företagsprofil</CardTitle>
          <CardDescription>Visas på SMS och i fakturor. Hålls privata mot kunderna.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <Field label="Företagsnamn">
            <Input value={form.company_name} onChange={(e) => update({ company_name: e.target.value })} placeholder="Verkstaden AB" />
          </Field>
          <Field label="Ditt namn">
            <Input value={form.display_name} onChange={(e) => update({ display_name: e.target.value })} placeholder="För- och efternamn" />
          </Field>
          <Field label="Kontakt e-post">
            <Input type="email" value={form.contact_email} onChange={(e) => update({ contact_email: e.target.value })} placeholder="kontakt@verkstaden.se" />
          </Field>
          <Field label="Kontakt telefon">
            <Input value={form.contact_phone} onChange={(e) => update({ contact_phone: e.target.value })} placeholder="08-123 45 67" />
          </Field>
          <Field label="Gatuadress" className="sm:col-span-2">
            <Input value={form.workshop_address} onChange={(e) => update({ workshop_address: e.target.value })} placeholder="Verkstadsvägen 1" />
          </Field>
          <Field label="Postnummer">
            <Input value={form.company_zip_code} onChange={(e) => update({ company_zip_code: e.target.value })} placeholder="123 45" />
          </Field>
          <Field label="Ort">
            <Input value={form.company_city} onChange={(e) => update({ company_city: e.target.value })} placeholder="Stockholm" />
          </Field>
          <Field label="Organisationsnummer">
            <Input value={form.company_org_number} onChange={(e) => update({ company_org_number: e.target.value })} placeholder="556677-8899" />
          </Field>
          <Field label="VAT-nummer (valfri)">
            <Input value={form.company_vat_number} onChange={(e) => update({ company_vat_number: e.target.value })} placeholder="SE556677889901" />
          </Field>

          {invoiceBank && onInvoiceBankChange && (
            <>
              <div className="sm:col-span-2 pt-1">
                <p className="text-sm font-medium">Betalningsuppgifter</p>
                <p className="text-xs text-muted-foreground">
                  Visas i fakturans sidfot. Minst ett betalsätt (Bankgiro, Plusgiro eller IBAN) krävs innan en faktura kan skickas.
                </p>
              </div>
              <Field label="Bankgiro">
                <Input value={invoiceBank.bankgiro} onChange={(e) => onInvoiceBankChange({ bankgiro: e.target.value })} placeholder="123-4567" />
              </Field>
              <Field label="Plusgiro">
                <Input value={invoiceBank.plusgiro} onChange={(e) => onInvoiceBankChange({ plusgiro: e.target.value })} placeholder="12 34 56-7" />
              </Field>
              <Field label="IBAN">
                <Input value={invoiceBank.iban} onChange={(e) => onInvoiceBankChange({ iban: e.target.value })} placeholder="SE00 0000 0000 0000 0000 0000" />
              </Field>
              <Field label="Clearingnummer">
                <Input value={invoiceBank.clearingNumber} onChange={(e) => onInvoiceBankChange({ clearingNumber: e.target.value })} placeholder="8327-9" />
              </Field>
              <Field label="Kontonummer">
                <Input value={invoiceBank.accountNumber} onChange={(e) => onInvoiceBankChange({ accountNumber: e.target.value })} placeholder="123 456 789" />
              </Field>
              <Field label="Betalningsnotering (valfri)">
                <Input value={invoiceBank.paymentNote} onChange={(e) => onInvoiceBankChange({ paymentNote: e.target.value })} placeholder="Ange fakturanr vid betalning" />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SMS till kund</CardTitle>
          <CardDescription>Aviseringar som skickas automatiskt till kunden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Tacka-SMS efter upphämtning</p>
              <p className="text-xs text-muted-foreground">
                Skickas automatiskt när du markerar bilen som upphämtad och innehåller länk till Google-recension om angiven nedan.
              </p>
            </div>
            <Switch
              checked={form.pickup_sms_enabled}
              onCheckedChange={(v) => update(v ? { pickup_sms_enabled: true } : { pickup_sms_enabled: false, pickup_sms_review_enabled: false })}
            />
          </div>
          <Separator />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Inkludera recensionsförfrågan</p>
              <p className="text-xs text-muted-foreground">
                Lägg till en uppmaning att lämna en Google-recension i tacka-SMS:et.
              </p>
            </div>
            <Switch
              checked={form.pickup_sms_review_enabled}
              onCheckedChange={(v) => update({ pickup_sms_review_enabled: v })}
              disabled={!form.pickup_sms_enabled}
            />
          </div>
          {form.pickup_sms_review_enabled && (
            <>
              <Field label="Recensionsmeddelande">
                <Textarea
                  rows={3}
                  value={form.pickup_sms_review_message}
                  onChange={(e) => update({ pickup_sms_review_message: e.target.value })}
                  placeholder="Om du har en stund över skulle det betyda mycket för oss om du delade din upplevelse i en kort Google-recension:"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Recensionslänken läggs till automatiskt efter texten om Google-recensionslänk är ifylld nedan.
                </p>
              </Field>
              <Field label="Google-recensionslänk">
                <Input
                  value={form.google_review_url}
                  onChange={(e) => update({ google_review_url: e.target.value })}
                  placeholder="https://g.page/r/..."
                />
              </Field>
            </>
          )}
          <Field label="SMS-signatur (valfri)">
            <Input
              value={form.sms_signature}
              onChange={(e) => update({ sms_signature: e.target.value })}
              placeholder="Hälsningar, Verkstaden AB"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Push-notiser</CardTitle>
          <CardDescription>Aviseringar för viktiga händelser i verkstaden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {showDeviceNotifications && (
            <>
              <PushNotificationToggle />
              <Separator />
            </>
          )}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Nytt chattmeddelande från kund</p>
              <p className="text-xs text-muted-foreground">
                Skicka en notis varje gång en kund svarar i chatten.
              </p>
            </div>
            <Switch
              checked={form.notify_customer_messages}
              onCheckedChange={(v) => update({ notify_customer_messages: v })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Kund svarar på offert</p>
              <p className="text-xs text-muted-foreground">
                Skicka en notis till alla konton i verkstaden när en kund godkänner eller avvisar en offert.
              </p>
            </div>
            <Switch
              checked={form.notify_quote_responses}
              onCheckedChange={(v) => update({ notify_quote_responses: v })}
            />
          </div>
          {(featureFlags.opportunities_enabled || featureFlags.campaigns_enabled) && (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Påminnelser om obesvarade uppföljningar &amp; kampanjer</p>
                <p className="text-xs text-muted-foreground">
                  Skickas högst en gång per dygn när det finns uppföljningar eller kampanjer som legat obehandlade i flera dagar.
                </p>
              </div>
              <Switch
                checked={form.notify_pending_reminders}
                onCheckedChange={(v) => update({ notify_pending_reminders: v })}
              />
            </div>
          )}
          <Separator />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Notiser på mobil</p>
              <p className="text-xs text-muted-foreground">
                Skicka push-notiser till mobilenheter. Stäng av utan att tappa registreringen — kan slås på igen direkt.
              </p>
            </div>
            <Switch
              checked={form.notify_mobile_push}
              onCheckedChange={(v) => update({ notify_mobile_push: v })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Notiser på dator</p>
              <p className="text-xs text-muted-foreground">
                Skicka push-notiser till datorer och surfplattor. Stäng av utan att tappa registreringen — kan slås på igen direkt.
              </p>
            </div>
            <Switch
              checked={form.notify_desktop_push}
              onCheckedChange={(v) => update({ notify_desktop_push: v })}
            />
          </div>
          {showDeviceNotifications && (
            <p className="text-xs text-muted-foreground">
              Aktivera notiser separat på varje enhet (dator, telefon). På iPhone måste sidan vara tillagd på hemskärmen och du måste aktivera notiser inifrån den installerade appen — det fungerar inte från Safari-fliken.
            </p>
          )}
        </CardContent>
      </Card>

      {showAiPrompts && (
      <>
      <Card>
        <CardHeader>
          <CardTitle>AI – Uppföljningar</CardTitle>
          <CardDescription>
            {isDeveloper
              ? "Developer-läge: hela bas-prompten är redigerbar nedan."
              : "Extra instruktioner som läggs till i AI:ns prompt när uppföljningar identifieras. Lämna tomt för standardbeteende."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isDeveloper ? (
            <Field label="Bas-prompt (hela)">
              <Textarea
                rows={20}
                className="font-mono text-xs"
                value={oppBaseValue}
                onChange={(e) => update({ opportunity_prompt_base: e.target.value })}
              />
              <div className="flex justify-between items-center mt-1.5">
                <p className="text-xs text-muted-foreground">
                  {form.opportunity_prompt_base
                    ? "Anpassad version aktiv."
                    : "Standard-prompt visas. Ändringar sparas som din egen version."}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => update({ opportunity_prompt_base: "" })}>
                  Återställ till standard
                </Button>
              </div>
            </Field>
          ) : (
            <Field label="Dina instruktioner till AI:n">
              <Textarea
                rows={5}
                value={form.opportunity_prompt_extra}
                onChange={(e) => update({ opportunity_prompt_extra: e.target.value })}
                placeholder={"T.ex.:\n- Skapa aldrig uppföljningar för kunder som redan tackat nej\n- Var extra försiktig med tonen för företagskunder"}
              />
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI – Service-kampanjer</CardTitle>
          <CardDescription>
            Extra instruktioner samt vilka metrics AI:n får använda för att förutsäga service-intervall.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isDeveloper ? (
            <Field label="Bas-prompt (hela)">
              <Textarea
                rows={20}
                className="font-mono text-xs"
                value={svcBaseValue}
                onChange={(e) => update({ service_prompt_base: e.target.value })}
              />
              <div className="flex justify-between items-center mt-1.5">
                <p className="text-xs text-muted-foreground">
                  {form.service_prompt_base
                    ? "Anpassad version aktiv."
                    : "Standard-prompt visas. Ändringar sparas som din egen version."}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => update({ service_prompt_base: "" })}>
                  Återställ till standard
                </Button>
              </div>
            </Field>
          ) : (
            <Field label="Dina instruktioner till AI:n">
              <Textarea
                rows={5}
                value={form.service_prompt_extra}
                onChange={(e) => update({ service_prompt_extra: e.target.value })}
                placeholder={"T.ex.:\n- Räkna med 10000 km / 12 mån för dieslar äldre än 2015\n- Ignorera bilar utan registrerad mätarställning"}
              />
            </Field>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm">Metrics som AI:n får använda</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => update({ service_metrics: null })}>
                Återställ till standard
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Kryssa ur en metric för att utesluta den från underlaget AI:n får. {effectiveMetricKeys.size} av{" "}
              {allMetrics.length} aktiva.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {allMetrics.map((m) => {
                const enabled = effectiveMetricKeys.has(m.key);
                return (
                  <label
                    key={m.key}
                    className="flex items-start gap-2 rounded-md border bg-card p-2.5 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(v) => toggleMetric(m.key, v === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{m.label}</p>
                      <p className="text-xs text-muted-foreground">{m.description}</p>
                      <code className="text-[10px] text-muted-foreground/70">{m.key}</code>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-sm">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
