import { createFileRoute, Link } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listCamps,
  generateCamps,
  updateCamp,
  approveCamp,
  dismissCamp,
  rewriteCampMessage,
} from "@/lib/campaigns.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Check, X, Wand2, Loader2, ArrowLeft, Users, AlertCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { FeatureDisabledNotice } from "@/components/FeatureGate";

export const Route = createFileRoute("/_authenticated/campaigns")({
  component: CampaignsGate,
});

function CampaignsGate() {
  useScrollTopOnMount();
  const { flags, isLoading } = useFeatureFlags();
  if (isLoading) {
    return (
      <main className="max-w-2xl mx-auto p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Laddar…</p>
      </main>
    );
  }
  if (!flags.campaigns_enabled) return <FeatureDisabledNotice title="Kampanjer" />;
  return <CampaignsPage />;
}

type Recipient = {
  job_id: string | null;
  customer_name: string;
  customer_first_name?: string;
  customer_phone: string | null;
  registration_number: string | null;
  predicted_service_due_date: string | null;
  predicted_reason: string | null;
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

function CampaignsPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listCamps);
  const genFn = useServerFn(generateCamps);
  const updFn = useServerFn(updateCamp);
  const apprFn = useServerFn(approveCamp);
  const dismFn = useServerFn(dismissCamp);
  const rewFn = useServerFn(rewriteCampMessage);

  const { data, isLoading } = useQuery({ queryKey: ["campaigns"], queryFn: () => fetchList() });

  const generate = useMutation({
    mutationFn: () => genFn(),
    onSuccess: (r) => {
      toast.success(`${r.created} kampanj${r.created === 1 ? "" : "er"} skapad${r.created === 1 ? "" : "e"}`);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link to="/insights" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> Tillbaka till insikter
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> Kampanjer</h1>
          <p className="text-sm text-muted-foreground">AI grupperar kunder med liknande behov och föreslår ett mall-SMS</p>
        </div>
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Megaphone className="h-4 w-4 mr-2" />}
          Hitta kampanjer (Service)
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Laddar...</p>}
      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Inga kampanjer än. Klicka på <strong>Hitta kampanjer</strong> så analyserar AI alla bilar och föreslår servicepåminnelser.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {(data?.items ?? []).map((camp) => (
          <CampCard
            key={camp.id}
            camp={camp as never}
            onUpdate={(patch) => updFn({ data: { id: camp.id, ...patch } }).then(() => qc.invalidateQueries({ queryKey: ["campaigns"] }))}
            onApprove={() => apprFn({ data: { id: camp.id } }).then(() => { toast.success("Godkänd — skickas vid angiven tid"); qc.invalidateQueries({ queryKey: ["campaigns"] }); }).catch((e: Error) => toast.error(e.message))}
            onDismiss={() => dismFn({ data: { id: camp.id } }).then(() => qc.invalidateQueries({ queryKey: ["campaigns"] }))}
            onAiRewrite={(instructions) => rewFn({ data: { id: camp.id, instructions } }).then(() => { toast.success("Omskrivet"); qc.invalidateQueries({ queryKey: ["campaigns"] }); }).catch((e: Error) => toast.error(e.message))}
          />
        ))}
      </div>
    </main>
  );
}

type CampLike = {
  id: string;
  title: string;
  campaign_type: string;
  reason: string;
  suggested_message: string;
  suggested_send_at: string;
  recipients: Recipient[];
  status: string;
  send_error: string | null;
  send_results: { sent?: number; failed?: number } | null;
};

function CampCard({
  camp, onUpdate, onApprove, onDismiss, onAiRewrite,
}: {
  camp: CampLike;
  onUpdate: (p: { suggested_message?: string; suggested_send_at?: string; recipients?: Recipient[] }) => Promise<unknown>;
  onApprove: () => void;
  onDismiss: () => void;
  onAiRewrite: (instructions: string | null) => Promise<unknown>;
}) {
  const [msg, setMsg] = useState(camp.suggested_message);
  const [sendAt, setSendAt] = useState(toLocalInput(camp.suggested_send_at));
  const [recipients, setRecipients] = useState<Recipient[]>(camp.recipients ?? []);
  const [aiBusy, setAiBusy] = useState(false);
  const dirty =
    msg !== camp.suggested_message ||
    fromLocalInput(sendAt) !== camp.suggested_send_at ||
    JSON.stringify(recipients) !== JSON.stringify(camp.recipients ?? []);

  const statusBadge =
    camp.status === "pending" ? <Badge variant="outline">Väntar</Badge>
    : camp.status === "approved" ? <Badge className="bg-emerald-600">Godkänd – schemalagd</Badge>
    : camp.status === "sent" ? <Badge className="bg-blue-600">Skickad{camp.send_results?.sent != null ? ` (${camp.send_results.sent}/${(camp.send_results.sent ?? 0) + (camp.send_results.failed ?? 0)})` : ""}</Badge>
    : camp.status === "failed" ? <Badge variant="destructive">Fel</Badge>
    : <Badge variant="secondary">Avfärdad</Badge>;

  const locked = camp.status === "sent" || camp.status === "dismissed";
  const preview = recipients[0] ? msg.replace(/\{namn\}/gi, recipients[0].customer_first_name || recipients[0].customer_name.split(" ")[0] || recipients[0].customer_name) : msg;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{camp.title}</CardTitle>
            <div className="text-xs text-muted-foreground mt-1 italic">{camp.campaign_type}</div>
          </div>
          {statusBadge}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{camp.reason}</p>

        <div className="space-y-1">
          <label className="text-xs font-medium flex items-center justify-between">
            <span>Mall-SMS (använd {"{namn}"} för förnamn)</span>
            <span className="text-muted-foreground">{msg.length}/320</span>
          </label>
          <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} maxLength={320} disabled={locked} />
          {recipients[0] && (
            <p className="text-xs text-muted-foreground italic">Förhandsvisning ({recipients[0].customer_name}): "{preview}"</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Skickas</label>
            <Input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} disabled={locked} className="w-56" />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={locked || aiBusy}
            onClick={async () => {
              setAiBusy(true);
              try { await onAiRewrite(null); } finally { setAiBusy(false); }
            }}
          >
            {aiBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />} AI-skriv om
          </Button>
          {dirty && !locked && (
            <Button size="sm" variant="secondary" onClick={() => onUpdate({ suggested_message: msg, suggested_send_at: fromLocalInput(sendAt), recipients })}>
              Spara ändringar
            </Button>
          )}
        </div>

        <div className="border rounded-md">
          <div className="px-3 py-2 text-xs font-medium flex items-center gap-2 border-b bg-muted/40">
            <Users className="h-3.5 w-3.5" /> Mottagare ({recipients.length})
          </div>
          <ul className="divide-y">
            {recipients.map((r, i) => (
              <li key={i} className="px-3 py-2 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{r.customer_name} {r.registration_number && <span className="text-muted-foreground text-xs font-mono ml-1">{r.registration_number}</span>}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.customer_phone ?? "—"}
                    {r.predicted_service_due_date && <> · Service ≈ {r.predicted_service_due_date}</>}
                    {r.predicted_reason && <> · {r.predicted_reason}</>}
                  </div>
                </div>
                {!locked && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRecipients(recipients.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
            {recipients.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">Inga mottagare kvar — avfärda kampanjen.</li>}
          </ul>
        </div>

        {camp.send_error && (
          <div className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {camp.send_error}</div>
        )}

        {!locked && (
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              <X className="h-4 w-4 mr-1" /> Avfärda
            </Button>
            {camp.status === "pending" && recipients.length > 0 && (
              <Button size="sm" onClick={async () => {
                if (dirty) await onUpdate({ suggested_message: msg, suggested_send_at: fromLocalInput(sendAt), recipients });
                onApprove();
              }}>
                <Check className="h-4 w-4 mr-1" /> Godkänn & schemalägg ({recipients.length})
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}