import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useLayoutEffect, useState } from "react";
import { getCustomerJob, respondToQuote } from "@/lib/customer.functions";
import { readCredential, writeCredential, clearCredential } from "@/lib/customer-credential";
import { shareOrDownloadBlob } from "@/lib/pdf-download";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  ArrowLeft,
  Paperclip,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Download,
  Receipt,
} from "lucide-react";
import { SipomaxLogo } from "@/components/SipomaxLogo";
import { MediaGallery, type LightboxItem } from "@/components/media-lightbox";
import {
  statusIcon,
  statusLabelCustomer,
  statusTone,
  TONE_ICON,
} from "@/lib/status";

export const Route = createFileRoute("/c/$token/updates/$updateId")({
  component: CustomerUpdateDetail,
});

function CustomerUpdateDetail() {
  const { token } = Route.useParams();
  const [cred, setCred] = useState<string | null>(() => readCredential(token));

  if (!cred) {
    return (
      <CredGate
        token={token}
        onUnlock={(c) => {
          writeCredential(token, c);
          setCred(c);
        }}
      />
    );
  }
  return <DetailView token={token} cred={cred} onForget={() => { clearCredential(token); setCred(null); }} />;
}

function CredGate({ token, onUnlock }: { token: string; onUnlock: (c: string) => void }) {
  const fetchJob = useServerFn(getCustomerJob);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetchJob({ data: { token, credential: value } });
      onUnlock(value);
    } catch (err: any) {
      toast.error(err.message ?? "Uppgifterna stämmer inte");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Toaster />
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <SipomaxLogo className="h-12 w-12 inline-block mb-3" />
          <h1 className="text-2xl font-bold">Ditt fordon</h1>
          <p className="text-sm text-muted-foreground">Ange ditt telefonnummer för att se denna uppdatering</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cred">Telefonnummer</Label>
                <Input id="cred" type="tel" required value={value} onChange={(e) => setValue(e.target.value)} placeholder="070 123 45 67" autoFocus />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Kontrollerar..." : "Öppna"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailView({ token, cred, onForget }: { token: string; cred: string; onForget: () => void }) {
  const { token: tokenParam, updateId } = Route.useParams();
  const fetchJob = useServerFn(getCustomerJob);
  const respond = useServerFn(respondToQuote);
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  // The invoice is served by a plain HTTP endpoint (gated by the same
  // token+credential pair as everything else here), so it can be opened as a
  // regular link in a new tab — the only PDF delivery that renders reliably
  // in every mobile browser. blob: URLs in a new tab show a blank page in
  // iOS Safari.
  const invoicePdfUrl =
    `/api/public/invoice-pdf?token=${encodeURIComponent(token)}` +
    `&credential=${encodeURIComponent(cred)}`;

  // Land at the top — without this the page can inherit the previous page's
  // scroll position and open scrolled to the bottom.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  async function refresh() {
    try {
      const r = await fetchJob({ data: { token, credential: cred } });
      setData(r);
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte ladda");
      onForget();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!data?.job?.id) return;
    const ch = supabase
      .channel(`cust-update-${data.job.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "status_updates", filter: `job_id=eq.${data.job.id}` }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [data?.job?.id]);

  async function downloadFile(url: string, filename: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Kunde inte hämta filen");
      const blob = await res.blob();
      await shareOrDownloadBlob(blob, filename);
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte ladda ner filen");
    }
  }

  async function decide(decision: "approved" | "rejected") {
    setActing(true);
    try {
      await respond({ data: { token, credential: cred, update_id: updateId, decision } });
      toast.success(decision === "approved" ? "Offert godkänd" : "Offert avvisad");
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Toaster />
        <p className="text-sm text-muted-foreground">Laddar...</p>
      </div>
    );
  }
  if (!data) return null;

  const update = data.updates.find((u: any) => u.id === updateId);
  if (!update) {
    return (
      <div className="min-h-screen bg-muted/20">
        <Toaster />
        <main className="max-w-2xl mx-auto p-4">
          <Link
            to="/c/$token"
            params={{ token: tokenParam }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="h-4 w-4" /> Tillbaka till uppdateringar
          </Link>
          <p className="text-sm text-muted-foreground">Denna uppdatering finns inte längre.</p>
        </main>
      </div>
    );
  }

  const Icon = statusIcon(update.status, update.approval_state);
  const tone = statusTone(update.status, update.approval_state);
  const created = new Date(update.created_at);
  const dateStr = created.toLocaleString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
  });

  const amount = update.quote_amount != null ? Number(update.quote_amount) : null;
  const priorApproved = amount != null
    ? data.updates
        .filter((p: any) => p.quote_amount != null && p.approval_state === "approved" && new Date(p.created_at) < new Date(update.created_at))
        .reduce((s: number, p: any) => s + Number(p.quote_amount), 0)
    : 0;

  const attachments = update.status_update_attachments ?? [];
  // Images and videos share one gallery + lightbox (kept in attachment order,
  // so swiping in the lightbox walks through everything the workshop sent).
  const media: LightboxItem[] = attachments
    .filter((a: any) => a.mime_type?.startsWith("image/") || a.mime_type?.startsWith("video/"))
    .map((a: any) => ({
      url: a.signed_url as string,
      name: a.file_name as string,
      kind: a.mime_type?.startsWith("video/") ? ("video" as const) : ("image" as const),
    }));
  const files = attachments.filter((a: any) => !a.mime_type?.startsWith("image/") && !a.mime_type?.startsWith("video/"));
  const quoteLines: any[] = Array.isArray(update.articles) ? update.articles : [];

  return (
    <div className="min-h-screen bg-muted/20">
      <Toaster />
      <header className="border-b bg-background sticky top-0 z-10">
        <div className="max-w-2xl mx-auto p-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/c/$token", params: { token: tokenParam } })}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Tillbaka
          </button>
          <div className="ml-auto text-right">
            <p className="font-semibold text-sm">{data.job.registration_number}</p>
            <p className="text-xs text-muted-foreground">
              {[data.job.vehicle_make, data.job.vehicle_model].filter(Boolean).join(" ") || data.job.customer_name}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 pb-12">
        {/* Header */}
        <header className="flex items-start gap-4 pb-6 border-b">
          <div className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON[tone]}`}>
            <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{statusLabelCustomer(update.status)}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">{dateStr}</p>
          </div>
        </header>

        {update.description && update.status !== "invoice_sent" && (
          <section className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Meddelande från oss
            </h2>
            <div className="rounded-lg border bg-muted/30 p-4 sm:p-5">
              <p className="text-[15px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {update.description}
              </p>
            </div>
          </section>
        )}

        {update.status === "invoice_sent" && (
          <section className="mt-6">
            {/* A plain link to the PDF endpoint — the browser's own viewer
                opens it in a new tab (with its built-in save/share controls),
                which works on mobile and desktop alike. */}
            <a
              href={invoicePdfUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center gap-4 rounded-xl border bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 transition-colors px-5 py-4 text-left"
            >
              <div className="h-11 w-11 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                <Receipt className="h-5 w-5 text-emerald-700" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-800">Öppna faktura (PDF)</p>
                <p className="text-xs text-emerald-700/80 mt-0.5">
                  {data.job.fortnox_invoice_id ? `Faktura #${data.job.fortnox_invoice_id} — ` : ""}
                  Öppnas i en ny flik där du kan spara eller dela den.
                </p>
              </div>
            </a>
          </section>
        )}

        {quoteLines.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Offertrader
            </h2>
            <div className="rounded-lg border overflow-hidden text-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs">
                    <th className="text-left font-medium px-3 py-2">Beskrivning</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Ant.</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">À-pris</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Summa</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {quoteLines.map((line: any, i: number) => {
                    const qty = Number(line.quantity ?? 1);
                    const price = Number(line.unit_price ?? 0);
                    const sub = qty * price;
                    return (
                      <tr key={i} className="bg-card">
                        <td className="px-3 py-2.5 font-medium">{line.description || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{qty}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                          {price.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
                          {sub.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {quoteLines.length > 1 && (() => {
                  const total = quoteLines.reduce((acc: number, l: any) => acc + Number(l.quantity ?? 1) * Number(l.unit_price ?? 0), 0);
                  return (
                    <tfoot>
                      <tr className="border-t bg-muted/30">
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Totalt</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold whitespace-nowrap">
                          {total.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                        </td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </section>
        )}

        {amount != null && (
          <section className="mt-4">
            <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-2 text-sm">
              {priorApproved > 0 ? (
                <>
                  <div className="flex justify-between text-muted-foreground"><span>Tidigare godkänt</span><span>{priorApproved.toFixed(2)} kr</span></div>
                  <div className="flex justify-between"><span>Tilläggsoffert</span><span className="font-medium">+ {amount.toFixed(2)} kr</span></div>
                  <div className="flex justify-between border-t pt-2 mt-2 text-base font-semibold"><span>Ny totalsumma</span><span>{(priorApproved + amount).toFixed(2)} kr</span></div>
                </>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Offertbelopp</span>
                  <span className="text-2xl font-semibold tabular-nums">{amount.toFixed(2)} kr</span>
                </div>
              )}
              {update.requires_approval && (
                <div className="pt-2"><ApprovalBadge state={update.approval_state} /></div>
              )}
            </div>
          </section>
        )}

        {update.requires_approval && update.approval_state === "pending" && (
          <section className="mt-6 flex gap-2">
            <Button className="flex-1" disabled={acting} onClick={() => decide("approved")}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Godkänn
            </Button>
            <Button className="flex-1" variant="outline" disabled={acting} onClick={() => decide("rejected")}>
              <XCircle className="h-4 w-4 mr-1.5" /> Avvisa
            </Button>
          </section>
        )}


        {media.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              Bilder och videor ({media.length})
            </h2>
            <MediaGallery items={media} />
            <p className="text-xs text-muted-foreground mt-2">
              Tryck på en bild eller video för att öppna den i helskärm.
            </p>
          </section>
        )}

        {files.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              Filer ({files.length})
            </h2>
            <ul className="space-y-2">
              {files.map((f: any) => {
                const url = f.signed_url as string;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => downloadFile(url, f.file_name)}
                      className="w-full flex items-center gap-3 rounded-lg border bg-card p-3 sm:p-4 hover:bg-muted/50 transition-colors group text-left"
                    >
                      <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.file_name}</p>
                        <p className="text-xs text-muted-foreground">{f.mime_type ?? "Fil"}</p>
                      </div>
                      <Download className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!update.description && update.quote_amount == null && attachments.length === 0 && (
          <section className="mt-8">
            <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center">
              <Paperclip className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Inga ytterligare detaljer har lagts till på denna uppdatering.
              </p>
            </div>
          </section>
        )}

        <div className="mt-10 pt-6 border-t">
          <Button variant="outline" asChild className="w-full sm:w-auto">
            <Link to="/c/$token" params={{ token: tokenParam }}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Tillbaka till alla uppdateringar
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

function ApprovalBadge({ state }: { state?: string | null }) {
  if (state === "approved") {
    return (
      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5" /> Godkänd
      </Badge>
    );
  }
  if (state === "rejected") {
    return (
      <Badge variant="secondary" className="bg-red-50 text-red-700 gap-1.5">
        <XCircle className="h-3.5 w-3.5" /> Avvisad
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-amber-50 text-amber-700 gap-1.5">
      <Clock className="h-3.5 w-3.5" /> Inväntar ditt godkännande
    </Badge>
  );
}

