import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useLayoutEffect, useMemo } from "react";
import { toast } from "sonner";
import { getJob } from "@/lib/jobs.functions";
import { getFinalInvoicePdf } from "@/lib/invoice.functions";
import { traceInvoiceOpen } from "@/lib/invoice-open-trace";
import { openOrDownloadPdf } from "@/lib/pdf-download";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Paperclip,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Download,
  Receipt,
  Loader2,
} from "lucide-react";
import {
  statusIcon,
  statusLabel,
  statusTone,
  TONE_ICON,
} from "@/lib/status";
import { MediaGallery, type LightboxItem } from "@/components/media-lightbox";

export const Route = createFileRoute("/_authenticated/jobs/$id/updates/$updateId")({
  component: UpdateDetailPage,
});

function UpdateDetailPage() {
  const { id, updateId } = Route.useParams();
  const navigate = useNavigate();
  const fetchJob = useServerFn(getJob);
  const openFinalPdf = useServerFn(getFinalInvoicePdf);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  // Fallback viewer state for jobs without portal credentials.
  const [inlinePdf, setInlinePdf] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: () => fetchJob({ data: { id } }),
  });

  // Land at the top — the job page behind this route is often scrolled down
  // to the timeline, and without a reset this page inherits that scroll
  // position and opens at the bottom. useLayoutEffect so the reset happens
  // before paint (and before any view-transition snapshot).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [updateId]);

  if (isLoading) {
    return <main className="p-6"><p className="text-sm text-muted-foreground">Laddar...</p></main>;
  }
  if (!data?.job) {
    return <main className="p-6"><p>Uppdatering hittades inte.</p></main>;
  }

  const update = data.updates.find((u: any) => u.id === updateId);
  if (!update) {
    return (
      <main className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
        <Link to="/jobs/$id" params={{ id }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" /> Tillbaka till uppdateringar
        </Link>
        <p className="text-sm text-muted-foreground">Denna uppdatering finns inte längre.</p>
      </main>
    );
  }

  const job = data.job;
  const isInvoiceUpdate = (update.status as string) === "invoice_sent";
  const invoiceId = job.fortnox_invoice_id ?? job.visma_invoice_id;

  // Opens the finished invoice. The popup tab must open a REAL https URL:
  // opening an empty tab and document.write-ing a spinner into it kills the
  // current page on iOS Safari (traced via client_diagnostics: pagehide fires
  // ~100ms after window.open and the app reloads). The invoice endpoint
  // re-renders the PDF from the job's frozen snapshot and redirects to a
  // signed Storage URL, so the tab lands in the browser's native PDF viewer —
  // the little in-app browser on mobile.
  async function handleOpenInvoice() {
    traceInvoiceOpen("open:start", `update-page job=${job.id}`);
    if (job.job_token && job.customer_phone) {
      const pdfUrl =
        `/api/public/invoice-pdf?token=${encodeURIComponent(job.job_token)}` +
        `&credential=${encodeURIComponent(job.customer_phone)}`;
      traceInvoiceOpen("open:direct-url-tab");
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      traceInvoiceOpen("open:done");
      return;
    }
    // No customer-portal credentials on the job — fetch the PDF and show it
    // in the inline viewer instead (same pipeline, no tab involved).
    setInvoiceBusy(true);
    try {
      traceInvoiceOpen("open:fetching (no-token fallback)");
      const r = await openFinalPdf({ data: { job_id: job.id } });
      traceInvoiceOpen("open:fetched", `pdf=${r.pdf_base64 ? `${r.pdf_base64.length} chars` : "EMPTY"}`);
      if (r.pdf_base64) {
        traceInvoiceOpen("open:show-inline-viewer");
        setInlinePdf(r.pdf_base64);
      } else {
        toast.error("Kunde inte generera PDF");
      }
      traceInvoiceOpen("open:done");
    } catch (err: any) {
      traceInvoiceOpen("open:error", err?.message ?? err);
      toast.error(err?.message ?? "Kunde inte öppna fakturan");
    } finally {
      setInvoiceBusy(false);
    }
  }

  const Icon = statusIcon(update.status, update.approval_state);
  const tone = statusTone(update.status, update.approval_state);
  const created = new Date(update.created_at);
  const dateStr = created.toLocaleString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const attachments = update.status_update_attachments ?? [];
  // Images and videos share one gallery + fullscreen lightbox, same component
  // the customer page uses, so the workshop sees exactly what the customer sees.
  const media: LightboxItem[] = attachments
    .filter((a: any) => a.mime_type?.startsWith("image/") || a.mime_type?.startsWith("video/"))
    .map((a: any) => ({
      url: a.signed_url as string,
      name: a.file_name as string,
      kind: a.mime_type?.startsWith("video/") ? ("video" as const) : ("image" as const),
    }));
  const files = attachments.filter(
    (a: any) => !a.mime_type?.startsWith("image/") && !a.mime_type?.startsWith("video/"),
  );

  return (
    <main className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Back nav */}
      <div className="mb-8">
        <button
          type="button"
          onClick={() => navigate({ to: "/jobs/$id", params: { id } })}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Tillbaka till uppdateringar
        </button>
      </div>

      {/* Header */}
      <header className="flex items-start gap-5 pb-8 border-b">
        <div className={`h-14 w-14 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON[tone]}`}>
          <Icon className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            {statusLabel(update.status)}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">{dateStr}</p>
        </div>
      </header>

      {/* Invoice card */}
      {isInvoiceUpdate && (
        <section className="mt-8">
          <button
            type="button"
            onClick={handleOpenInvoice}
            disabled={invoiceBusy}
            className="w-full sm:w-auto flex items-center gap-4 rounded-xl border bg-emerald-50 hover:bg-emerald-100 transition-colors px-5 py-4 text-left disabled:opacity-50"
          >
            <div className="h-11 w-11 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              {invoiceBusy
                ? <Loader2 className="h-5 w-5 text-emerald-700 animate-spin" />
                : <Receipt className="h-5 w-5 text-emerald-700" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800">
                {invoiceBusy ? "Öppnar…" : "Öppna / ladda ner faktura (PDF)"}
              </p>
              {invoiceId && (
                <p className="text-xs text-emerald-700/80 mt-0.5">Faktura #{invoiceId}</p>
              )}
            </div>
          </button>
          {inlinePdf && <InlinePdfCard pdfBase64={inlinePdf} invoiceId={invoiceId ?? ""} />}
        </section>
      )}

      {/* Workshop notes — only shown when a comment was actually added */}
      {update.description && !isInvoiceUpdate && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Anteckningar från verkstaden
          </h2>
          <div className="rounded-lg border bg-muted/30 p-5">
            <p className="text-[15px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {update.description}
            </p>
          </div>
        </section>
      )}

      {/* Quote */}
      {update.quote_amount != null && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Offert
          </h2>
          <div className="rounded-lg border bg-card p-5 flex items-center justify-between">
            <div>
              <p className="text-3xl font-semibold text-foreground tabular-nums">
                {Number(update.quote_amount).toFixed(2)} kr
              </p>
              <p className="text-xs text-muted-foreground mt-1">Offererat till kund</p>
            </div>
            {update.requires_approval && <ApprovalBadge state={update.approval_state} />}
          </div>
        </section>
      )}

      {/* Approval state without quote */}
      {update.quote_amount == null && update.requires_approval && (
        <section className="mt-8 flex items-center gap-2">
          <ApprovalBadge state={update.approval_state} />
        </section>
      )}

      {/* Images and videos — tap to open the fullscreen lightbox */}
      {media.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Bilder och videor ({media.length})
          </h2>
          <MediaGallery items={media} />
        </section>
      )}

      {/* Other files */}
      {files.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Filer ({files.length})
          </h2>
          <ul className="space-y-2">
            {files.map((f: any) => {
              const url = f.signed_url as string;
              return (
                <li key={f.id}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors group"
                  >
                    <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.file_name}</p>
                      <p className="text-xs text-muted-foreground">{f.mime_type ?? "Fil"}</p>
                    </div>
                    <Download className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Empty state when no workshop content */}
      {!update.description && update.quote_amount == null && attachments.length === 0 && (
        <section className="mt-10">
          <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <Paperclip className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Verkstaden har inte lagt till några anteckningar eller bilder på denna uppdatering.
            </p>
          </div>
        </section>
      )}

      {/* Footer back */}
      <div className="mt-12 pt-6 border-t">
        <Button variant="outline" asChild>
          <Link to="/jobs/$id" params={{ id }}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Tillbaka till alla uppdateringar
          </Link>
        </Button>
      </div>
    </main>
  );
}

function ApprovalBadge({ state }: { state?: string | null }) {
  if (state === "approved") {
    return (
      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5" /> Kund godkänd
      </Badge>
    );
  }
  if (state === "rejected") {
    return (
      <Badge variant="secondary" className="bg-red-50 text-red-700 gap-1.5">
        <XCircle className="h-3.5 w-3.5" /> Kund avvisade
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-amber-50 text-amber-700 gap-1.5">
      <Clock className="h-3.5 w-3.5" /> Inväntar godkännande
    </Badge>
  );
}

// Fallback in-app viewer for jobs without portal credentials — same blob
// iframe approach as the job page's preview card, with a download button.
function InlinePdfCard({ pdfBase64, invoiceId }: { pdfBase64: string; invoiceId: string }) {
  const url = useMemo(() => {
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }, [pdfBase64]);
  return (
    <div className="mt-4 rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <p className="text-sm font-semibold">Faktura {invoiceId ? `#${invoiceId}` : ""}</p>
        <button
          type="button"
          onClick={() => void openOrDownloadPdf(pdfBase64, `faktura-${invoiceId || "pdf"}.pdf`)}
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          Ladda ned PDF
        </button>
      </div>
      <div className="bg-gray-100 p-4">
        <iframe
          src={url}
          className="w-full border-0 shadow-md"
          style={{ height: "1120px" }}
          title={`Faktura ${invoiceId}`}
        />
      </div>
    </div>
  );
}
