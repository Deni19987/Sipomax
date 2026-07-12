import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  listOpps,
  generateOpps,
  updateOpp,
  approveOpp,
  dismissOpp,
  rewriteOppMessage,
} from "@/lib/opportunities.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Check,
  X,
  Wand2,
  Loader2,
  ArrowLeft,
  Send,
  AlertCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { FeatureDisabledNotice } from "@/components/FeatureGate";

export const Route = createFileRoute("/_authenticated/opportunities")({
  component: OpportunitiesGate,
});

function OpportunitiesGate() {
  const { flags, isLoading } = useFeatureFlags();
  if (isLoading) {
    return (
      <main className="max-w-2xl mx-auto p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Laddar…</p>
      </main>
    );
  }
  if (!flags.opportunities_enabled) return <FeatureDisabledNotice title="Uppföljningar" />;
  return <OpportunitiesPage />;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

function OpportunitiesPage() {
  const [tab, setTab] = useState<"scheduled" | "pending" | "history">("pending");
  const qc = useQueryClient();
  const fetchList = useServerFn(listOpps);
  const genFn = useServerFn(generateOpps);
  const updFn = useServerFn(updateOpp);
  const apprFn = useServerFn(approveOpp);
  const dismFn = useServerFn(dismissOpp);
  const rewFn = useServerFn(rewriteOppMessage);

  const { data, isLoading } = useQuery({ queryKey: ["opportunities"], queryFn: () => fetchList() });

  const generate = useMutation({
    mutationFn: () => genFn(),
    onSuccess: (r) => {
      toast.success(
        `${r.created} uppföljning${r.created === 1 ? "" : "ar"} skapad${r.created === 1 ? "" : "e"}`,
      );
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            to="/insights"
            className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="h-3 w-3" /> Tillbaka till insikter
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Uppföljningar
          </h1>
          <p className="text-sm text-muted-foreground">
            AI hittar var vi behöver följa upp med kunder — för att hålla arbetet rullande och skapa
            en bättre upplevelse
          </p>
        </div>
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          Generera uppföljningar
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Laddar...</p>}
      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Inga uppföljningar än. Klicka på <strong>Generera uppföljningar</strong> så analyserar
            AI alla jobb och chattar.
          </CardContent>
        </Card>
      )}

      {!isLoading && (data?.items.length ?? 0) > 0 && (
        <>
          <div className="flex items-center gap-2">
            {[
              { key: "pending" as const, label: "Förslag", icon: Sparkles, count: data?.items.filter((o) => o.status === "pending").length ?? 0 },
              { key: "scheduled" as const, label: "Planerade", icon: Send, count: data?.items.filter((o) => o.status === "approved").length ?? 0 },
              { key: "history" as const, label: "Historik", icon: Clock, count: data?.items.filter((o) => o.status !== "approved" && o.status !== "pending").length ?? 0 },
            ].map((t) => {
              const active = tab === t.key;
              return (
                <Button
                  key={t.key}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTab(t.key)}
                  className="gap-1.5"
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                  <Badge variant={active ? "secondary" : "outline"} className="ml-0.5 text-[10px] px-1.5 py-0">
                    {t.count}
                  </Badge>
                </Button>
              );
            })}
          </div>

          {(() => {
            const items = data?.items ?? [];
            const scheduled = items.filter((o) => o.status === "approved");
            const pending = items.filter((o) => o.status === "pending");
            const other = items.filter(
              (o) => o.status !== "approved" && o.status !== "pending",
            );
            const renderCard = (opp: Opp) => (
              <OppCard
                key={opp.id}
                opp={opp}
                onUpdate={(patch) =>
                  updFn({ data: { id: opp.id, ...patch } }).then(() =>
                    qc.invalidateQueries({ queryKey: ["opportunities"] }),
                  )
                }
                onApprove={() =>
                  apprFn({ data: { id: opp.id } })
                    .then(() => {
                      toast.success("Godkänd — skickas vid angiven tid");
                      qc.invalidateQueries({ queryKey: ["opportunities"] });
                    })
                    .catch((e: Error) => toast.error(e.message))
                }
                onDismiss={() =>
                  dismFn({ data: { id: opp.id } }).then(() =>
                    qc.invalidateQueries({ queryKey: ["opportunities"] }),
                  )
                }
                onAiRewrite={(instructions) =>
                  rewFn({ data: { id: opp.id, instructions } })
                    .then(() => {
                      toast.success("Omskrivet");
                      qc.invalidateQueries({ queryKey: ["opportunities"] });
                    })
                    .catch((e: Error) => toast.error(e.message))
                }
              />
            );

            let list: Opp[] = [];
            let emptyText = "";
            if (tab === "scheduled") {
              list = scheduled;
              emptyText = "Inga planerade uppföljningar. Godkänn förslag under Förslag-fliken.";
            } else if (tab === "pending") {
              list = pending;
              emptyText = "Inga nya förslag just nu. Generera uppföljningar för att hitta fler.";
            } else {
              list = other;
              emptyText = "Ingen historik ännu.";
            }

            return (
              <div className="space-y-3">
                {list.length > 0 ? (
                  <div className="grid gap-4">{list.map(renderCard)}</div>
                ) : (
                  <p className="text-sm text-muted-foreground">{emptyText}</p>
                )}
              </div>
            );
          })()}
        </>
      )}
    </main>
  );
}

type Opp = NonNullable<Awaited<ReturnType<typeof listOpps>>["items"]>[number];

function OppCard({
  opp,
  onUpdate,
  onApprove,
  onDismiss,
  onAiRewrite,
}: {
  opp: Opp;
  onUpdate: (p: { suggested_message?: string; suggested_send_at?: string }) => Promise<unknown>;
  onApprove: () => void;
  onDismiss: () => void;
  onAiRewrite: (instructions: string | null) => Promise<unknown>;
}) {
  const [msg, setMsg] = useState(opp.suggested_message);
  const [sendAt, setSendAt] = useState(toLocalInput(opp.suggested_send_at));
  const [aiBusy, setAiBusy] = useState(false);
  const dirty = msg !== opp.suggested_message || fromLocalInput(sendAt) !== opp.suggested_send_at;

  const statusBadge =
    opp.status === "pending" ? (
      <Badge variant="outline">Väntar</Badge>
    ) : opp.status === "approved" ? (
      <Badge className="bg-emerald-600">Godkänd – schemalagd</Badge>
    ) : opp.status === "sent" ? (
      <Badge className="bg-blue-600">Skickad</Badge>
    ) : opp.status === "failed" ? (
      <Badge variant="destructive">Fel</Badge>
    ) : (
      <Badge variant="secondary">Avfärdad</Badge>
    );

  const locked = opp.status === "sent" || opp.status === "dismissed";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">{opp.title}</CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              {opp.customer_name}
              {opp.customer_phone ? ` • ${opp.customer_phone}` : ""} •{" "}
              <span className="italic">{opp.opportunity_type}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {opp.job_id && (
              <Button asChild variant="outline" size="sm">
                <Link to="/jobs/$id" params={{ id: opp.job_id }} search={{ redirect: "/opportunities" }}>
                  <ExternalLink className="h-3.5 w-3.5" /> Öppna jobb
                </Link>
              </Button>
            )}
            {statusBadge}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{opp.reason}</p>

        {opp.trigger_context && (
          <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 rounded-md px-3 py-2">
            <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{opp.trigger_context}</span>
          </div>
        )}

        {opp.chat.length > 0 && (
          <TriggerChat chat={opp.chat} triggerIds={opp.trigger_message_ids ?? []} />
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium flex items-center justify-between">
            <span>Föreslaget meddelande</span>
            <span className="text-muted-foreground">{msg.length}/320</span>
          </label>
          <Textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={4}
            maxLength={320}
            disabled={locked}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Skickas</label>
            <Input
              type="datetime-local"
              value={sendAt}
              onChange={(e) => setSendAt(e.target.value)}
              disabled={locked}
              className="w-56"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={locked || aiBusy}
            onClick={async () => {
              setAiBusy(true);
              try {
                await onAiRewrite(null);
              } finally {
                setAiBusy(false);
              }
            }}
          >
            {aiBusy ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1" />
            )}{" "}
            AI-skriv om
          </Button>
          {dirty && !locked && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onUpdate({ suggested_message: msg, suggested_send_at: fromLocalInput(sendAt) })
              }
            >
              Spara ändringar
            </Button>
          )}
        </div>

        {opp.send_error && (
          <div className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {opp.send_error}
          </div>
        )}

        {!locked && (
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              <X className="h-4 w-4 mr-1" /> Avfärda
            </Button>
            {opp.status === "pending" && (
              <Button
                size="sm"
                onClick={async () => {
                  if (dirty)
                    await onUpdate({
                      suggested_message: msg,
                      suggested_send_at: fromLocalInput(sendAt),
                    });
                  onApprove();
                }}
              >
                <Check className="h-4 w-4 mr-1" /> Godkänn & schemalägg
              </Button>
            )}
            {opp.status === "approved" && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Send className="h-3 w-3" /> Skickas vid angiven tid
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TriggerChat({
  chat,
  triggerIds,
}: {
  chat: Array<{ id: string; sender_type: string; body: string; created_at: string }>;
  triggerIds: string[];
}) {
  const triggerSet = new Set(triggerIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 100, visible: false });

  function updateIndicator() {
    const el = scrollRef.current;
    if (!el) return;

    const visible = el.scrollHeight > el.clientHeight + 1;
    const height = visible ? Math.max((el.clientHeight / el.scrollHeight) * 100, 16) : 100;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const top = visible && maxScroll > 0 ? (el.scrollTop / maxScroll) * (100 - height) : 0;

    setIndicator({ top, height, visible });
  }

  useEffect(() => {
    updateIndicator();

    const el = scrollRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(el);
    if (el.firstElementChild) resizeObserver.observe(el.firstElementChild);

    return () => resizeObserver.disconnect();
  }, [chat.length]);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0 flex flex-col h-64">
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollRef}
            onScroll={updateIndicator}
            className="h-full overflow-y-scroll overscroll-contain p-3 pr-6 space-y-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {chat.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Inga meddelanden än</p>
            )}
            {chat.map((m) => {
              const isWorkshop = m.sender_type === "workshop";
              const isTrigger = triggerSet.has(m.id);
              const bubbleClass = [
                "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                isWorkshop ? "bg-primary text-primary-foreground" : "bg-muted",
                isTrigger ? "ring-2 ring-amber-400 dark:ring-amber-500" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={m.id} className={`flex ${isWorkshop ? "justify-end" : "justify-start"}`}>
                  <div className={bubbleClass}>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="text-[10px] mt-1 opacity-70">
                      {new Date(m.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pointer-events-none absolute right-2 top-3 bottom-3 w-1 rounded-full bg-muted">
            <div
              className="absolute left-0 w-full rounded-full bg-primary transition-[top,height] duration-150"
              style={{
                top: indicator.visible ? `${indicator.top}%` : "0%",
                height: indicator.visible ? `${indicator.height}%` : "2.5rem",
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
