import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getCustomerJob, sendCustomerMessage, notifyCustomerMessage } from "@/lib/customer.functions";
import { readCredential, writeCredential, clearCredential } from "@/lib/customer-credential";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Send, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { SipomaxLogo } from "@/components/SipomaxLogo";
import {
  statusLabelCustomer,
  statusVariant,
  statusIcon,
  statusDescription,
  statusTone,
  TONE_DOT,
  TONE_ICON,
} from "@/lib/status";

export const Route = createFileRoute("/c/$token")({
  component: CustomerPortal,
});

function CustomerPortal() {
  const { token } = Route.useParams();
  const isUpdateDetailRoute = useRouterState({
    select: (state) => state.location.pathname.includes(`/c/${token}/updates/`),
  });
  const [cred, setCred] = useState<string | null>(() => readCredential(token));

  if (isUpdateDetailRoute) return <Outlet />;

  if (!cred) {
    return <CredGate token={token} onUnlock={(c) => { writeCredential(token, c); setCred(c); }} />;
  }
  return <PortalView token={token} cred={cred} onForget={() => { clearCredential(token); setCred(null); }} />;
}

function CredGate({ token, onUnlock }: { token: string; onUnlock: (c: string) => void }) {
  const fetchJob = useServerFn(getCustomerJob);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCredError(null);
    setLoading(true);
    try {
      await fetchJob({ data: { token, credential: value } });
      onUnlock(value);
    } catch (err: any) {
      setCredError("Telefonnumret stämmer inte. Kontrollera att du anger samma nummer som är registrerat på jobbet.");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Toaster />
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <SipomaxLogo className="h-12 w-12 inline-block mb-3" />
          <h1 className="text-2xl font-bold">Ditt fordon</h1>
          <p className="text-sm text-muted-foreground">Ange ditt telefonnummer för att se uppdateringar</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cred">Telefonnummer</Label>
                <Input
                  id="cred"
                  type="tel"
                  required
                  value={value}
                  aria-invalid={!!credError}
                  className={credError ? "border-destructive focus-visible:ring-destructive" : ""}
                  onChange={(e) => { setValue(e.target.value); setCredError(null); }}
                  placeholder="070 123 45 67"
                  autoFocus
                />
                {credError && (
                  <p className="text-sm text-destructive">{credError}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Kontrollerar..." : "Öppna"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PortalView({ token, cred, onForget }: { token: string; cred: string; onForget: () => void }) {
  const fetchJob = useServerFn(getCustomerJob);
  const sendMsg = useServerFn(sendCustomerMessage);
  const notifyMsg = useServerFn(notifyCustomerMessage);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  // Messages shown instantly on send, before the refetch lands; cleared once
  // the real row (same body) arrives.
  const [optimistic, setOptimistic] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [token]);

  async function refresh() {
    try {
      const r = await fetchJob({ data: { token, credential: cred } });
      setData(r);
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte ladda");
      onForget();
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!data?.job?.id) return;
    const ch = supabase
      .channel(`cust-${data.job.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `job_id=eq.${data.job.id}` }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "status_updates", filter: `job_id=eq.${data.job.id}` }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [data?.job?.id]);

  // Drop optimistic messages once the real row (same body) arrives on refetch.
  useEffect(() => {
    if (optimistic.length === 0) return;
    const realBodies = new Set(
      (data?.messages ?? []).filter((m: any) => m.sender_type === "customer").map((m: any) => m.body),
    );
    setOptimistic((prev) => prev.filter((m) => !realBodies.has(m.body)));
  }, [data?.messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    // Show the message immediately — delivery is just a DB insert the workshop
    // reads via realtime. The push heads-up to the workshop runs separately in
    // the background and never blocks this.
    const tempId = `tmp-${crypto.randomUUID()}`;
    setOptimistic((prev) => [
      ...prev,
      { id: tempId, sender_type: "customer", body: text, created_at: new Date().toISOString() },
    ]);
    setBody("");
    setSending(true);
    try {
      await sendMsg({ data: { token, credential: cred, body: text } });
      refresh();
      void notifyMsg({ data: { token, credential: cred, body: text } }).catch(() => {});
    } catch (err: any) {
      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      setBody(text);
      toast.error(err.message);
    } finally { setSending(false); }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-sm text-muted-foreground">Laddar...</p></div>;
  if (!data) return null;
  const { job, updates, messages } = data;
  // Merge real + optimistic, dropping optimistic messages whose real row has
  // already arrived so nothing renders twice.
  const mergedMessages = [
    ...messages,
    ...optimistic.filter((o) => !messages.some((m: any) => m.sender_type === "customer" && m.body === o.body)),
  ];

  return (
    <div className="min-h-screen bg-muted/20">
      <Toaster />
      <header className="border-b bg-background sticky top-0 z-10">
        <div className="max-w-2xl mx-auto p-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{job.registration_number}</p>
            <p className="text-xs text-muted-foreground">{[job.vehicle_make, job.vehicle_model].map(v => v?.replace(/\s*uppgift saknas.?\s*/gi, "").trim() || null).filter(Boolean).join(" ") || job.customer_name}</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        <Tabs defaultValue="status">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="status">Uppdateringar</TabsTrigger>
            <TabsTrigger value="chat">Chatt ({messages.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="space-y-1">
            {updates.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Inga uppdateringar än</p>}
            {updates.map((u: any, i: number) => {
              const needsAction = u.requires_approval && u.approval_state === "pending";
              const hasDetails = Boolean(
                u.description ||
                u.quote_amount != null ||
                u.requires_approval ||
                (u.status_update_attachments && u.status_update_attachments.length > 0)
              );
              // A responded quote shows its outcome inline on the quote item
              // itself (green approved / red rejected) — no separate row.
              const badge = needsAction ? (
                <Badge variant="outline" className="text-yellow-700 border-yellow-600">Åtgärd krävs</Badge>
              ) : u.status === "quote_sent" && u.approval_state === "approved" ? (
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Godkänd
                </Badge>
              ) : u.status === "quote_sent" && u.approval_state === "rejected" ? (
                <Badge variant="secondary" className="bg-red-50 text-red-700 gap-1">
                  <XCircle className="h-3 w-3" /> Avvisad
                </Badge>
              ) : undefined;
              return (
              <CustomerStatusItem
                key={u.id}
                token={token}
                updateId={u.id}
                status={u.status}
                approvalState={u.approval_state}
                createdAt={u.created_at}
                isLast={i === updates.length - 1}
                hasDetails={hasDetails}
                badge={badge}
              />
              );
            })}
          </TabsContent>

          <TabsContent value="chat">
            <Card>
              <CardContent className="p-0 flex flex-col h-[70vh]">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {mergedMessages.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Inga meddelanden än</p>}
                  {mergedMessages.map((m: any) => (
                    <div key={m.id} className={`flex ${m.sender_type === "customer" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm break-words ${m.sender_type === "customer" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className="text-[10px] mt-1 opacity-70">{new Date(m.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={send} className="border-t p-3 flex gap-2">
                  <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Meddela verkstaden..." />
                  <Button type="submit" size="icon" disabled={sending}><Send className="h-4 w-4" /></Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function CustomerStatusItem({
  token,
  updateId,
  status,
  approvalState,
  createdAt,
  isLast,
  hasDetails,
  badge,
}: {
  token: string;
  updateId: string;
  status: string;
  approvalState?: string | null;
  createdAt: string;
  isLast?: boolean;
  hasDetails?: boolean;
  badge?: React.ReactNode;
}) {
  const Icon = statusIcon(status, approvalState);
  const tone = statusTone(status, approvalState);
  const date = new Date(createdAt);
  const dateStr = date.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <div className="relative flex gap-4">
      <div className="relative flex flex-col items-center pt-5">
        <div className={`h-2.5 w-2.5 rounded-full ${TONE_DOT[tone]}`} />
        {!isLast && <div className="flex-1 w-px bg-border mt-2" />}
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <Link
          to="/c/$token/updates/$updateId"
          params={{ token, updateId }}
          className="group block rounded-lg -mx-2 px-2 py-3 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start gap-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON[tone]}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm sm:text-base font-semibold">{statusLabelCustomer(status)}</p>
                <p className="hidden sm:block text-sm text-muted-foreground whitespace-nowrap">{dateStr}</p>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 line-clamp-2">
                {statusDescription(status, approvalState)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 sm:hidden">{dateStr}</p>
              {badge && <div className="mt-2">{badge}</div>}
              {hasDetails && (
                <p className="text-xs text-primary mt-1.5 font-medium">Visa detaljer →</p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-4 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
          </div>
        </Link>
      </div>
    </div>
  );
}