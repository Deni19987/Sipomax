import { createFileRoute, Link, Outlet, useRouterState, useNavigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { getJob, addStatusUpdate, sendWorkshopMessage, notifyWorkshopMessageSms, sendCustomerSmsLink, deleteJob, updateJobNotes, patchJobPhone, updateJobBilling } from "@/lib/jobs.functions";
import { rewriteText } from "@/lib/ai.functions";
import { voiceToSms, rewriteSms } from "@/lib/ai.functions";
import { previewFortnoxInvoice, finalizeFortnoxInvoice, getFinalInvoicePdf, searchFortnoxCustomers, createFortnoxCustomer, updateFortnoxCustomer, getFortnoxPaymentTerms, getFortnoxCustomerDefaults, getCompanyProfileStatus } from "@/lib/invoice.functions";
import { rankCustomers } from "@/lib/customer-match";
import { ArticlePicker } from "@/components/article-picker";
import { FortnoxInvoicePreview } from "@/components/FortnoxInvoicePreview";
import { type ArticleLine, articlesSubtotal, formatSek, normalizeArticleLine } from "@/lib/articles";
import { openOrDownloadPdf } from "@/lib/pdf-download";
import { traceInvoiceOpen } from "@/lib/invoice-open-trace";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Copy, Send, Paperclip, Phone, User as UserIcon, MessageSquare, MoreHorizontal, X, Sparkles, Loader2, Mic, Square, Wand2, KeyRound, CheckCircle2, Plus, Trash2, Receipt, Eye, SendHorizontal, Clock, Pin, PinOff, Pencil, ChevronDown, ChevronUp, Lightbulb, StickyNote, AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";
import { STATUS_OPTIONS, statusLabel, statusVariant, type JobStatus } from "@/lib/status";
import { StatusTimelineItem } from "@/components/status-timeline-item";


// Full-layout placeholder shown while a job that wasn't preloaded is still
// loading. With pendingMs: 0 the router commits this immediately, so the page
// slide plays right away into a stable skeleton instead of stalling on the old
// page until the data arrives; the real content swaps in (no extra animation)
// once the loader resolves.
function JobDetailSkeleton() {
  return (
    <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 overflow-x-hidden">
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-5 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 hidden sm:block" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      <div className="rounded-xl border bg-card p-5 mb-5 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="flex gap-2 mb-5">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/_authenticated/jobs/$id")({
  component: JobDetailPage,
  // Prefetch the job into the same React Query cache key the component reads,
  // triggered on link hover/touch via the router's `intent` preloading. By the
  // time the user clicks, the data is usually already there — no loading flash.
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["job", params.id],
      queryFn: () => getJob({ data: { id: params.id } }),
    }),
  // Show the skeleton the instant navigation starts (pendingMs: 0) rather than
  // waiting ~1s. This lets the page-slide animation run immediately into the
  // skeleton on a slow / not-yet-preloaded job, instead of freezing on the
  // previous page until the data lands.
  pendingComponent: JobDetailSkeleton,
  pendingMs: 0,
});

// Thumbnail for a not-yet-uploaded attachment in the status-update form.
// Images/videos render a small preview via an object URL (revoked on unmount);
// other files fall back to a name chip.
function PendingAttachment({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage && !isVideo) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage, isVideo]);

  if ((isImage || isVideo) && objectUrl) {
    return (
      <div className="relative h-16 w-16 rounded-md overflow-hidden border bg-muted group" title={file.name}>
        {isImage ? (
          <img src={objectUrl} alt={file.name} className="h-full w-full object-cover" />
        ) : (
          <video src={objectUrl} muted playsInline preload="metadata" className="h-full w-full object-cover pointer-events-none" />
        )}
        {isVideo && (
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="h-5 w-5 rounded-full bg-black/55 text-white flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-2.5 w-2.5 translate-x-px"><path d="M8 5.14v13.72c0 .86.94 1.39 1.68.94l10.9-6.86a1.1 1.1 0 0 0 0-1.88L9.68 4.2A1.1 1.1 0 0 0 8 5.14Z" /></svg>
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
          aria-label={`Ta bort ${file.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs bg-muted px-2 py-1 rounded">
      <Paperclip className="h-3 w-3" />
      {file.name}
      <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground" aria-label={`Ta bort ${file.name}`}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

type Note = { id: string; title: string; content: string; created_at: string; pinned: boolean };

function parseNotes(raw: string | null | undefined): Note[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Note[];
  } catch {}
  // Legacy plain-text → single note
  return [{ id: crypto.randomUUID(), title: "Anteckning", content: raw, created_at: new Date().toISOString(), pinned: false }];
}

function serializeNotes(notes: Note[]): string {
  return JSON.stringify(notes);
}

function JobDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "status";
    const h = window.location.hash.replace("#", "");
    return h === "chat" || h === "invoice" || h === "notes" ? h : "status";
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  // Track whether this page was opened with a hash anchor (e.g. from a
  // push notification). When true, we hide the page until we've scrolled
  // the tabs section into view to avoid a visible top-then-jump flash.
  const initialHashRef = useRef<string>(
    typeof window !== "undefined" ? window.location.hash.replace("#", "") : ""
  );
  const openedFromHash = initialHashRef.current === "chat" || initialHashRef.current === "invoice";
  const [scrollReady, setScrollReady] = useState<boolean>(!openedFromHash);
  // useLayoutEffect (not useEffect) so this runs synchronously before paint —
  // the View Transition snapshots the page in its post-commit state, and a
  // passive effect fires too late, after that snapshot, causing a visible
  // jump-to-top once the animation reveals the live (already-scrolled) DOM.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    // Only auto-scroll to top when opening the page normally (no hash).
    // When opened via notification with #chat (or #invoice), let the
    // tab-scroll effect below place the chat in view instead.
    const h = window.location.hash.replace("#", "");
    if (!h) window.scrollTo(0, 0);
  }, [id]);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      setActiveTab(h === "chat" || h === "invoice" || h === "notes" ? h : "status");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const location = useLocation();
  const isUpdateDetailRoute = useRouterState({
    select: (state) => state.location.pathname.includes(`/jobs/${id}/updates/`),
  });
  const fetchJob = useServerFn(getJob);
  const doDelete = useServerFn(deleteJob);
  const saveNotesFn = useServerFn(updateJobNotes);
  const postStatus = useServerFn(addStatusUpdate);
  const [pickupLoading, setPickupLoading] = useState(false);
  const qc = useQueryClient();

  const searchParams = new URLSearchParams(location.search);
  const redirectBack = searchParams.get("redirect") || "/dashboard";
  const backLabel = redirectBack === "/opportunities" ? "Tillbaka till uppföljningar" : "Tillbaka till jobb";
  const { data, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: () => fetchJob({ data: { id } }),
  });
  // Scroll the tabs section into view synchronously (before paint) once
 // the data is loaded and the tabs DOM is mounted, so the user never sees
 // the page rendered at the top first.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (!openedFromHash) return;
    if (activeTab !== "chat" && activeTab !== "invoice") return;
    if (!data?.job?.id) return;
    if (!tabsRef.current) return;
    tabsRef.current.scrollIntoView({ behavior: "auto", block: "start" });
    setScrollReady(true);
  }, [openedFromHash, activeTab, data?.job?.id]);
  // Safety: never leave the page hidden indefinitely if something prevents
  // the layout effect from running (e.g. data fails to load).
  useEffect(() => {
    if (scrollReady) return;
    const t = setTimeout(() => setScrollReady(true), 1500);
    return () => clearTimeout(t);
  }, [scrollReady]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBlockedDeleteDialog, setShowBlockedDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Realtime: refresh on any change for this job
  useEffect(() => {
    const ch = supabase
      .channel(`job-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `job_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["job", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "status_updates", filter: `job_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["job", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["job", id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  // Sync notes from server (initialise once; after that local state is source of truth)
  useEffect(() => {
    if (data?.job) setNotes(parseNotes(data.job.notes ?? null));
  }, [data?.job?.id]); // only re-init when the job itself changes, not on every refetch

  async function persistNotes(next: Note[]) {
    try {
      await saveNotesFn({ data: { job_id: id, notes: serializeNotes(next) } });
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte spara anteckning");
    }
  }

  function handleAddNote(title: string, content: string) {
    if (!title.trim() && !content.trim()) return;
    const next = [
      { id: crypto.randomUUID(), title: title.trim() || "Anteckning", content: content.trim(), created_at: new Date().toISOString(), pinned: false },
      ...notes,
    ];
    setNotes(next);
    persistNotes(next);
  }

  function handleEditNote(noteId: string, title: string, content: string) {
    const next = notes.map((n) => n.id === noteId ? { ...n, title: title.trim() || "Anteckning", content: content.trim() } : n);
    setNotes(next);
    persistNotes(next);
  }

  function handleDeleteNote(noteId: string) {
    const next = notes.filter((n) => n.id !== noteId);
    setNotes(next);
    persistNotes(next);
  }

  function handleTogglePin(noteId: string) {
    const next = notes.map((n) => n.id === noteId ? { ...n, pinned: !n.pinned } : n);
    setNotes(next);
    persistNotes(next);
  }

  async function onConfirmDelete() {
    setDeleting(true);
    try {
      await doDelete({ data: { id } });
      toast.success("Jobbet raderades");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte radera jobbet");
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  if (isUpdateDetailRoute) return <Outlet />;

  if (isLoading) return <main className="p-6"><p className="text-sm text-muted-foreground">Laddar...</p></main>;
  if (!data?.job) return <main className="p-6"><p>Jobbet hittades inte.</p></main>;

  const job = data.job;
  const hasInvoice =
    !!(job.fortnox_invoice_id || job.visma_invoice_id || job.invoice_generated_at || job.invoice_booked_at) ||
    data.updates.some((u: any) => u.status === "invoice_sent");
  const hasSentUpdates = data.updates.some((u: any) => u.status !== "order_received");
  const customerUrl = `${window.location.origin}/c/${job.job_token}`;
  const showPickupBanner =
    (job.current_status === "job_done" ||
      !!(job.visma_invoice_id || job.fortnox_invoice_id || job.invoice_booked_at) ||
      data.updates.some((u: any) => u.status === "invoice_sent")) &&
    job.current_status !== "car_picked_up" &&
    !job.archived_at;

  async function handleMarkPickedUp() {
    setPickupLoading(true);
    try {
      await postStatus({
        data: {
          job_id: id,
          status: "car_picked_up",
          description: "Bilen upphämtad – jobbet avklarat.",
          origin: typeof window !== "undefined" ? window.location.origin : null,
        },
      });
      toast.success("Jobbet markerat som avklarat");
      qc.invalidateQueries({ queryKey: ["job", id] });
    } catch (e: any) {
      toast.error(e.message ?? "Misslyckades");
    } finally {
      setPickupLoading(false);
    }
  }

  return (
    <main
      className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 overflow-x-hidden"
      style={{ visibility: scrollReady ? "visible" : "hidden" }}
    >
      <div className="flex items-center justify-between mb-6">
        <Link to={redirectBack} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => { navigator.clipboard.writeText(customerUrl); toast.success("Kundlänk kopierad"); }}>
            <Copy className="h-4 w-4 mr-1.5" /> Kopiera länk
          </Button>
          {!hasInvoice && job.current_status !== "car_picked_up" && !job.archived_at && (
            <Button variant="outline" size="sm" disabled={pickupLoading} onClick={handleMarkPickedUp}>
              {pickupLoading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
              Klarmarkera
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  if (hasInvoice) {
                    setShowBlockedDeleteDialog(true);
                  } else if (hasSentUpdates) {
                    setShowDeleteDialog(true);
                  } else {
                    void onConfirmDelete();
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Radera jobb
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Radera jobb?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta tar bort jobbet permanent, inklusive alla statusuppdateringar, meddelanden och bilagor. Åtgärden kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Radera jobb
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBlockedDeleteDialog} onOpenChange={setShowBlockedDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kan inte radera jobbet</AlertDialogTitle>
            <AlertDialogDescription>
              En faktura har skickats till kunden. Jobbet kan inte längre raderas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowBlockedDeleteDialog(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showPickupBanner && (
        // On mobile the compact header "Klarmarkera" button only shows while
        // there is no invoice, so once an invoice exists the banner is the only
        // way to mark the car as picked up — keep it visible on phones too.
        <div className={hasInvoice ? "block" : "hidden sm:block"}>
        <MarkPickedUpBanner
          jobId={id}
          hasInvoice={hasInvoice}
          onDone={() => qc.invalidateQueries({ queryKey: ["job", id] })}
        />
        </div>
      )}

      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)_260px] gap-6">
        {/* Left: vehicle card */}
        <div>
          <Card>
            <CardContent className="p-6 space-y-6">
              {/* Reg plate */}
              <div className="text-center">
                <p className="text-[10px] font-semibold tracking-widest text-primary uppercase mb-2">{job.identifier_type === "article" ? "Nr" : "Reg"}</p>
                <p className="text-4xl font-bold tracking-tight">{job.registration_number}</p>
                <p className="text-sm text-muted-foreground mt-3">
                  {[job.vehicle_make, job.vehicle_model].map(v => v?.replace(/\s*uppgift saknas\.?\s*/gi, "").trim() || null).filter(Boolean).join(" ") || "—"}
                </p>
              </div>

              <div className="h-px bg-border" />

              {/* Customer */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Kund</p>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <UserIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{job.customer_name}</p>
                    {job.customer_phone && (
                      <a href={`tel:${job.customer_phone}`} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {job.customer_phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="h-px bg-border" />

              {/* Meta rows */}
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Jobb #</span>
                  <span className="font-medium font-mono text-xs">{job.id.slice(0, 8)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Skapat</span>
                  <span className="font-medium">{new Date(job.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              </div>

              {/* Status pill */}
              <div className="pt-2">
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    <span className="text-sm font-medium">{statusLabel(job.current_status)}</span>
                  </div>
                  <Badge variant={statusVariant(job.current_status)} className="text-xs">Aktiv</Badge>
                </div>
              </div>

              {/* SMS action */}
              <SendSmsButton jobId={id} hasPhone={!!job.customer_phone} onPhoneAdded={() => qc.invalidateQueries({ queryKey: ["job", id] })} />
            </CardContent>
          </Card>
        </div>

        {/* Center: tabs */}
        <div ref={tabsRef} className="min-w-0 scroll-mt-4">
          <Card>
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v);
                if (typeof window !== "undefined") {
                  const newHash = v === "status" ? "" : `#${v}`;
                  history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
                }
              }}
            >
              <div className="border-b px-4 sm:px-6 overflow-x-auto">
                <TabsList className="bg-transparent p-0 h-auto gap-4 sm:gap-6">
                  <TabsTrigger value="status" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary px-0 py-3 font-medium">
                    Statusuppdateringar
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary px-0 py-3 font-medium">
                    Chatt ({data.messages.length})
                  </TabsTrigger>
                  <TabsTrigger value="invoice" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary px-0 py-3 font-medium">
                    Fakturering
                  </TabsTrigger>
                  {/* Notes tab: mobile only — hidden on lg where the right panel takes over */}
                  <TabsTrigger value="notes" className="lg:hidden rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary px-0 py-3 font-medium inline-flex items-center gap-1.5">
                    <StickyNote className="h-3.5 w-3.5" />
                    Anteckningar
                    {notes.length > 0 && (
                      <span className="ml-0.5 text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 leading-none font-semibold">
                        {notes.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="status" className="m-0 p-4 sm:p-6 space-y-0">
                <div className="space-y-0">
                  {data.updates.map((u: any, i: number) => {
                    const hasDetails = Boolean(
                      u.description ||
                      u.quote_amount != null ||
                      u.requires_approval ||
                      (u.status_update_attachments && u.status_update_attachments.length > 0)
                    );
                    return (
                    <StatusTimelineItem
                      key={u.id}
                      jobId={id}
                      updateId={u.id}
                      status={u.status}
                      createdAt={u.created_at}
                      approvalState={u.approval_state}
                      isLast={i === data.updates.length - 1}
                      hasDetails={hasDetails}
                    />
                    );
                  })}
                  {data.updates.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">Inga statusuppdateringar än.</p>
                  )}
                </div>

                <div className="pt-6 border-t -mx-4 px-4 sm:-mx-6 sm:px-6 mt-2">
                  <StatusComposer
                    jobId={id}
                    currentStatus={job.current_status}
                    initialPrice={job.initial_price != null ? Number(job.initial_price) : null}
                    hasStartedWork={data.updates.some((u: any) => u.status === "started_work")}
                    hasInvoice={hasInvoice}
                    customerPhone={job.customer_phone}
                    onPhoneAdded={() => qc.invalidateQueries({ queryKey: ["job", id] })}
                    onPosted={() => qc.invalidateQueries({ queryKey: ["job", id] })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="chat" className="m-0">
                <Chat
                  jobId={id}
                  messages={data.messages}
                  customerPhone={job.customer_phone}
                  onPhoneAdded={() => qc.invalidateQueries({ queryKey: ["job", id] })}
                />
              </TabsContent>

              <TabsContent value="invoice" className="m-0 p-4 sm:p-6">
                <InvoiceTab jobId={id} job={job} updates={data.updates} onDone={() => qc.invalidateQueries({ queryKey: ["job", id] })} />
              </TabsContent>

              {/* Mobile notes tab */}
              <TabsContent value="notes" className="m-0 p-4">
                <NotesContent
                  notes={notes}
                  onAdd={handleAddNote}
                  onEdit={handleEditNote}
                  onDelete={handleDeleteNote}
                  onTogglePin={handleTogglePin}
                />
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        {/* Right: notes panel — desktop only */}
        <div className="hidden lg:block">
          <NotesPanel
            notes={notes}
            collapsed={notesCollapsed}
            onToggleCollapsed={() => setNotesCollapsed((c) => !c)}
            onAdd={handleAddNote}
            onEdit={handleEditNote}
            onDelete={handleDeleteNote}
            onTogglePin={handleTogglePin}
          />
        </div>
      </div>
    </main>
  );
}

function SendSmsButton({ jobId, hasPhone, onPhoneAdded }: { jobId: string; hasPhone: boolean; onPhoneAdded?: () => void }) {
  const send = useServerFn(sendCustomerSmsLink);
  const patch = useServerFn(patchJobPhone);
  const [loading, setLoading] = useState(false);
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);

  async function onClick() {
    if (!hasPhone) {
      setShowPhoneDialog(true);
      return;
    }
    setLoading(true);
    try {
      await send({ data: { job_id: jobId, origin: window.location.origin } });
      toast.success("SMS skickat till kund");
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte skicka SMS");
    } finally {
      setLoading(false);
    }
  }

  async function savePhone(e: React.FormEvent) {
    e.preventDefault();
    const phone = phoneInput.trim();
    if (!phone) return;
    setSavingPhone(true);
    try {
      await patch({ data: { job_id: jobId, phone } });
      onPhoneAdded?.();
      setShowPhoneDialog(false);
      setPhoneInput("");
      await send({ data: { job_id: jobId, origin: window.location.origin } });
      toast.success("Nummer sparat och SMS skickat");
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte spara nummer");
    } finally {
      setSavingPhone(false);
    }
  }

  return (
    <>
      <Button type="button" variant="default" className="w-full mt-2" onClick={onClick} disabled={loading}>
        <MessageSquare className="h-4 w-4 mr-2" />
        {loading ? "Skickar..." : "Skicka länk via SMS"}
      </Button>
      <Dialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lägg till telefonnummer</DialogTitle>
            <DialogDescription>Ange kundens mobilnummer för att skicka SMS-länken.</DialogDescription>
          </DialogHeader>
          <form onSubmit={savePhone} className="space-y-3 pt-1">
            <Input
              autoFocus
              type="tel"
              placeholder="07X XXX XX XX"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={savingPhone || !phoneInput.trim()}>
                {savingPhone ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                Spara och skicka SMS
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => setShowPhoneDialog(false)}>Avbryt</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MarkPickedUpBanner({ jobId, onDone, hasInvoice }: { jobId: string; onDone: () => void; hasInvoice: boolean }) {
  const post = useServerFn(addStatusUpdate);
  const [loading, setLoading] = useState(false);
  async function onClick() {
    setLoading(true);
    try {
      await post({
        data: {
          job_id: jobId,
          status: "car_picked_up",
          description: "Bilen upphämtad – jobbet avklarat.",
          origin: typeof window !== "undefined" ? window.location.origin : null,
        },
      });
      toast.success("Jobbet markerat som avklarat");
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "Misslyckades");
    } finally {
      setLoading(false);
    }
  }
  // Only show the celebratory green "Faktura genererad" treatment once the
  // invoice actually exists. Before that, it's a plain mark-as-completed prompt.
  if (!hasInvoice) {
    return (
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Jobb klart</p>
            <p className="text-xs text-muted-foreground">Markera jobbet som avklarat när kunden hämtat bilen – kunden får då ett tack-SMS.</p>
          </div>
        </div>
        <Button onClick={onClick} disabled={loading} variant="outline" className="shrink-0">
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
          Klarmarkera
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-900">Faktura genererad</p>
          <p className="text-xs text-emerald-800/80">Markera jobbet som avklarat när kunden hämtat bilen – kunden får då ett tack-SMS.</p>
        </div>
      </div>
      <Button onClick={onClick} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
        {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
        Klarmarkera
      </Button>
    </div>
  );
}

function StatusComposer({ jobId, currentStatus, initialPrice, hasStartedWork, hasInvoice, customerPhone, onPhoneAdded, onPosted }: { jobId: string; currentStatus: string; initialPrice: number | null; hasStartedWork: boolean; hasInvoice: boolean; customerPhone: string | null; onPhoneAdded: () => void; onPosted: () => void }) {
  const post = useServerFn(addStatusUpdate);
  const patchPhone = useServerFn(patchJobPhone);
  const rewrite = useServerFn(rewriteText);
  const defaultNext: JobStatus =
    currentStatus === "job_done" ? "car_picked_up" :
    currentStatus === "diagnosis_started" ? "started_work" :
    currentStatus === "car_dropped_off" ? "diagnosis_started" :
    "in_progress";
  const [status, setStatus] = useState<JobStatus>(defaultNext);
  useEffect(() => {
    setStatus(
      currentStatus === "job_done" ? "car_picked_up" :
      currentStatus === "diagnosis_started" ? "started_work" :
      currentStatus === "car_dropped_off" ? "diagnosis_started" :
      "in_progress"
    );
  }, [currentStatus]);
  const [description, setDescription] = useState("");
  const [articles, setArticles] = useState<ArticleLine[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [includeInitialPrice, setIncludeInitialPrice] = useState(true);
  const [alreadyApproved, setAlreadyApproved] = useState(false);
  const [quoteError, setQuoteError] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  useEffect(() => { setIncludeInitialPrice(true); }, [initialPrice, hasStartedWork]);
  useEffect(() => { if (articles.length > 0) setQuoteError(false); }, [articles.length]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drag & drop attachments (desktop). dragenter/dragleave fire for every
  // child element crossed, so a depth counter — not a boolean — tracks
  // whether the pointer is still inside the form.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasDraggedFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  function onDragEnter(e: React.DragEvent) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
  }
  function onDragLeave(e: React.DragEvent) {
    if (!hasDraggedFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  }

  const hasPhone = !!customerPhone?.trim();

  const showInitialPriceChip =
    status === "started_work" && !hasStartedWork && initialPrice != null && initialPrice > 0 && includeInitialPrice;
  const quoteBlockedByInvoice = status === "quote_sent" && hasInvoice;

  async function savePhone(e?: React.SyntheticEvent) {
    e?.preventDefault();
    const phone = phoneInput.trim();
    if (!phone) return;
    setSavingPhone(true);
    try {
      await patchPhone({ data: { job_id: jobId, phone } });
      onPhoneAdded();
      setPhoneInput("");
      setShowPhoneDialog(false);
      toast.success("Telefonnummer sparat");
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte spara telefonnummer");
    } finally {
      setSavingPhone(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const isPreApprovedQuote = status === "quote_sent" && alreadyApproved;
    if (!hasPhone && !isPreApprovedQuote) {
      setShowPhoneDialog(true);
      return;
    }
    if (status === "quote_sent") {
      if (hasInvoice) {
        toast.error("En faktura har redan skapats för det här jobbet. Nya offerter kan inte skickas.");
        return;
      }
      if (articles.length === 0) {
        setQuoteError(true);
        toast.error("Lägg till minst en artikel i offerten");
        return;
      }
    }
    setQuoteError(false);
    setLoading(true);
    try {
      const attachments = [];
      for (const f of files) {
        const path = `${jobId}/${Date.now()}-${f.name}`;
        const { error } = await supabase.storage.from("job-attachments").upload(path, f);
        if (error) throw error;
        attachments.push({ file_path: path, file_name: f.name, mime_type: f.type });
      }
      await post({ data: {
        job_id: jobId,
        status,
        description: description || null,
        quote_amount:
          status === "quote_sent"
            ? articlesSubtotal(articles)
            : showInitialPriceChip
            ? initialPrice
            : null,
        approval_state: status === "quote_sent" && alreadyApproved ? "approved" : null,
        articles: status === "quote_sent" ? articles : undefined,
        attachments,
        origin: typeof window !== "undefined" ? window.location.origin : null,
      } });
      toast.success("Uppdatering publicerad");
      setDescription(""); setFiles([]); setArticles([]);
      if (fileRef.current) fileRef.current.value = "";
      onPosted();
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte publicera uppdatering");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-base font-semibold mb-3 text-foreground">Lägg till en statusuppdatering</p>
      <Dialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lägg till telefonnummer</DialogTitle>
            <DialogDescription>
              Kundens mobilnummer saknas. Statusuppdateringen skickas som SMS, så ett nummer krävs innan du kan publicera.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePhone} className="space-y-3 pt-1">
            <Input
              autoFocus
              type="tel"
              placeholder="07X XXX XX XX"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={savingPhone || !phoneInput.trim()}>
                {savingPhone ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Phone className="h-4 w-4 mr-2" />}
                Spara nummer
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => setShowPhoneDialog(false)}>Avbryt</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <form onSubmit={submit}>
        <div
          className={`relative rounded-lg border bg-background focus-within:border-primary/50 transition-colors overflow-hidden ${dragging ? "border-primary ring-2 ring-primary/25" : ""}`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {dragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 backdrop-blur-[1px] pointer-events-none">
              <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background px-4 py-3 text-sm font-medium text-primary shadow-sm">
                <Paperclip className="h-4 w-4" />
                Släpp filerna här för att bifoga
              </div>
            </div>
          )}
          {status === "quote_sent" && (
            <div className="px-4 pt-4 pb-1 space-y-3">
              {quoteBlockedByInvoice ? (
                <p className="text-sm font-medium text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  En faktura har redan skapats för det här jobbet. Nya offerter kan inte skickas.
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium">Offertrader (artiklar från Fortnox)</p>
                  <ArticlePicker value={articles} onChange={setArticles} addToLabel="offerten" />
                  {quoteError && articles.length === 0 && (
                    <p className="text-xs font-medium text-destructive">
                      Lägg till minst en artikel innan du kan publicera offerten.
                    </p>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 sm:py-2">
                    <div className="flex items-center gap-2 flex-1">
                      <Checkbox
                        id="already-approved"
                        checked={alreadyApproved}
                        onCheckedChange={(checked) => setAlreadyApproved(checked === true)}
                      />
                      <label
                        htmlFor="already-approved"
                        className="text-sm font-medium cursor-pointer flex-1"
                      >
                        Redan godkänd
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground sm:ml-auto">
                      Offerten godkänns direkt utan kundgodkännande
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {showInitialPriceChip && (
            <div className="px-4 pt-3">
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Startpris {initialPrice!.toLocaleString("sv-SE")} kr
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Läggs till på denna uppdatering. Eventuella offerter läggs på toppen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIncludeInitialPrice(false)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                  title="Ta bort startpris från denna uppdatering"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {(showComment || description) && (
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Skriv en kommentar till kunden…"
                rows={4}
                autoFocus={showComment && !description}
                className="w-full resize-none border-0 bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none pr-8"
              />
              <button
                type="button"
                onClick={() => { setDescription(""); setShowComment(false); }}
                className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Ta bort kommentar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {files.length > 0 && (
            <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
              {files.map((f, idx) => (
                <PendingAttachment key={idx} file={f} onRemove={() => setFiles(files.filter((_, i) => i !== idx))} />
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-2 py-2">
            <div className="flex items-center gap-1">
              <Select value={status} onValueChange={(v) => setStatus(v as JobStatus)}>
                <SelectTrigger className="h-8 border-0 bg-transparent shadow-none hover:bg-muted focus:ring-0 focus:ring-offset-0 text-sm font-medium gap-1 w-auto px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!showComment && !description && (
                <button
                  type="button"
                  onClick={() => setShowComment(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Lägg till en kommentar till kunden"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Lägg till kommentar
                </button>
              )}

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Bifoga fil — eller dra och släpp filer här"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              {(showComment || description) && (
                <button
                type="button"
                disabled={aiLoading || !description.trim()}
                onClick={async () => {
                  setAiLoading(true);
                  try {
                    const res = await rewrite({ data: { text: description, mode: "customer_update" } });
                    setDescription(res.text);
                    toast.success("Omskriven med AI");
                  } catch (err: any) {
                    toast.error(err.message ?? "AI-omskrivning misslyckades");
                  } finally {
                    setAiLoading(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Skriv om som ett polerat kundvänligt meddelande"
              >
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generera med AI
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
              />
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={loading || quoteBlockedByInvoice}
              className="rounded-md normal-case tracking-normal font-medium"
            >
              {loading ? "Publicerar…" : "Publicera uppdatering"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Chat({ jobId, messages, customerPhone, onPhoneAdded }: { jobId: string; messages: any[]; customerPhone: string | null; onPhoneAdded: () => void }) {
  const qc = useQueryClient();
  const send = useServerFn(sendWorkshopMessage);
  const notify = useServerFn(notifyWorkshopMessageSms);
  const patchPhone = useServerFn(patchJobPhone);
  const voiceFn = useServerFn(voiceToSms);
  const rewriteFn = useServerFn(rewriteSms);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const hasPhone = !!customerPhone?.trim();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function savePhone(e?: React.SyntheticEvent) {
    e?.preventDefault();
    const phone = phoneInput.trim();
    if (!phone) return;
    setSavingPhone(true);
    try {
      await patchPhone({ data: { job_id: jobId, phone } });
      onPhoneAdded();
      setPhoneInput("");
      setShowPhoneDialog(false);
      toast.success("Telefonnummer sparat");
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte spara telefonnummer");
    } finally {
      setSavingPhone(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    if (!hasPhone) {
      setShowPhoneDialog(true);
      return;
    }
    // Optimistic: show the message in the chat immediately and clear the
    // composer; reconcile with the server copy (or roll back) when the
    // request settles. The realtime subscription may deliver the server
    // copy before the request resolves, so dedupe by id on both paths.
    const tempId = `optimistic-${crypto.randomUUID()}`;
    const optimisticMsg = {
      id: tempId,
      job_id: jobId,
      sender_type: "workshop",
      body: text,
      created_at: new Date().toISOString(),
      optimistic: true,
    };
    qc.setQueryData(["job", jobId], (old: any) =>
      old ? { ...old, messages: [...old.messages, optimisticMsg] } : old
    );
    setBody("");
    setLoading(true);
    try {
      const res = await send({ data: { job_id: jobId, body: text } });
      qc.setQueryData(["job", jobId], (old: any) => {
        if (!old) return old;
        const rest = old.messages.filter((m: any) => m.id !== tempId);
        if (!rest.some((m: any) => m.id === res.message.id)) rest.push(res.message);
        return { ...old, messages: rest };
      });
      // Fire the customer SMS heads-up in the background — never awaited, so a
      // slow 46elks round-trip can't hold up the chat.
      void notify({ data: { job_id: jobId } }).catch(() => {});
    } catch (err: any) {
      qc.setQueryData(["job", jobId], (old: any) =>
        old ? { ...old, messages: old.messages.filter((m: any) => m.id !== tempId) } : old
      );
      setBody(text);
      toast.error(err.message ?? "Misslyckades");
    } finally { setLoading(false); }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setTranscribing(true);
        try {
          const buf = await blob.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const b64 = btoa(binary);
          const history = messages.map((m: any) => ({ sender_type: m.sender_type, body: m.body }));
          const r = await voiceFn({ data: { audio_base64: b64, mime_type: blob.type || "audio/webm", history } });
          setBody((prev) => (prev ? prev + " " : "") + r.text);
        } catch (err: any) {
          toast.error(err.message ?? "Kunde inte transkribera");
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err: any) {
      toast.error(err.message ?? "Åtkomst till mikrofon nekad");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function handleRewrite() {
    if (!body.trim()) return;
    setRewriting(true);
    try {
      const history = messages.map((m: any) => ({ sender_type: m.sender_type, body: m.body }));
      const r = await rewriteFn({ data: { text: body.trim(), history } });
      setBody(r.text);
      toast.success("Omskriven");
    } catch (err: any) {
      toast.error(err.message ?? "Omskrivning misslyckades");
    } finally {
      setRewriting(false);
    }
  }

  async function handleFinetune() {
    if (!body.trim()) return;
    setRewriting(true);
    try {
      const history = messages.map((m: any) => ({ sender_type: m.sender_type, body: m.body }));
      const r = await rewriteFn({ data: { text: body.trim(), mode: "finetune", history } });
      setBody(r.text);
      toast.success("Finjusterat");
    } catch (err: any) {
      toast.error(err.message ?? "Finjustering misslyckades");
    } finally {
      setRewriting(false);
    }
  }

  return (
    <div>
      <Dialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lägg till telefonnummer</DialogTitle>
            <DialogDescription>
              Kundens mobilnummer saknas. Meddelandet skickas som SMS, så ett nummer krävs innan du kan skicka.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePhone} className="space-y-3 pt-1">
            <Input
              autoFocus
              type="tel"
              placeholder="07X XXX XX XX"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={savingPhone || !phoneInput.trim()}>
                {savingPhone ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Phone className="h-4 w-4 mr-2" />}
                Spara nummer
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => setShowPhoneDialog(false)}>Avbryt</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <div className="flex flex-col h-[60vh]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Inga meddelanden än</p>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender_type === "workshop" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm break-words ${m.sender_type === "workshop" ? "bg-primary text-primary-foreground" : "bg-muted"}${m.optimistic ? " opacity-60" : ""}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[10px] mt-1 opacity-70`}>{new Date(m.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={submit} className="border-t p-3 flex flex-wrap gap-2 items-end">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={transcribing ? "Transkriberar röst..." : recording ? "Spelar in... tryck stopp när du är klar" : "Skicka meddelande till kunden..."}
            disabled={recording || transcribing}
            rows={3}
            className="min-h-[72px] resize-none flex-1 min-w-full sm:min-w-0"
          />
          {body.trim().length > 0 && (
            <>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={handleFinetune}
                disabled={rewriting || recording || transcribing || loading}
                title="Finjustera: små AI-justeringar av föregående text"
              >
                {rewriting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={handleRewrite}
                disabled={rewriting || recording || transcribing || loading}
                title="Skriv om: granska alla regler från grunden"
              >
                {rewriting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              </Button>
            </>
          )}
          <Button
            type="button"
            size="icon"
            variant={recording ? "destructive" : "outline"}
            onClick={recording ? stopRecording : startRecording}
            disabled={transcribing || loading || rewriting}
            title={recording ? "Stoppa inspelning" : "Spela in röst → AI skriver SMS"}
          >
            {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button type="submit" size="icon" disabled={loading || recording || transcribing || rewriting}><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </div>
  );
}

// All confirmed (approved) offers on the job — the source of truth for which
// status_update ids should contribute lines to the invoice.
function confirmedOfferUpdates(updates: any[]): any[] {
  return (updates ?? []).filter(
    (u: any) =>
      (u.status === "quote_sent" && u.approval_state === "approved") || u.status === "quote_approved",
  );
}

function articleLinesForOffer(u: any): ArticleLine[] {
  if (Array.isArray(u.articles) && u.articles.length) {
    return u.articles.map(normalizeArticleLine);
  }
  if (u.quote_amount != null) {
    return [{
      article_number: null,
      description: u.description || "Godkänd offert",
      quantity: 1,
      unit_price: Number(u.quote_amount),
      vat: 25,
    }];
  }
  return [];
}

// Aggregate the article lines from all confirmed offers (approved quotes). Offers
// created before article support fall back to a single line from their amount.
function confirmedOfferArticles(updates: any[]): ArticleLine[] {
  return confirmedOfferUpdates(updates).flatMap(articleLinesForOffer);
}



function InvoiceTab({ jobId, job, updates, onDone }: { jobId: string; job: any; updates: any[]; onDone: () => void }) {
  const preview = useServerFn(previewFortnoxInvoice);
  const openFinalPdf = useServerFn(getFinalInvoicePdf);
  const finalize = useServerFn(finalizeFortnoxInvoice);
  const searchCustomers = useServerFn(searchFortnoxCustomers);
  const createCust = useServerFn(createFortnoxCustomer);
  const saveBilling = useServerFn(updateJobBilling);
  const updateCust = useServerFn(updateFortnoxCustomer);
  const fetchPaymentTerms = useServerFn(getFortnoxPaymentTerms);
  const fetchCustomerDefaults = useServerFn(getFortnoxCustomerDefaults);
  const fetchCompanyStatus = useServerFn(getCompanyProfileStatus);
  const patchPhone = useServerFn(patchJobPhone);

  const isSent = !!job.invoice_booked_at;
  // Local flags lock the buttons immediately on success, without waiting for
  // the parent's job refetch to land — otherwise there's a window where the
  // job prop is still stale and a fast second click could re-finalize.
  const [bookedLocally, setBookedLocally] = useState(false);
  const [sentLocally, setSentLocally] = useState(false);
  // Booked (bokförd) and sent-to-customer are separate milestones: booking
  // freezes the invoice in Fortnox but the customer still needs it sent.
  const isBookkept = !!job.invoice_bookkept_at || bookedLocally;
  const isSentToCustomer = updates.some((u: any) => u.status === "invoice_sent") || sentLocally;

  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);

  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<"send" | "book_send" | null>(null);
  const [skipSendConfirm, setSkipSendConfirm] = useState(false);
  // New key (not the old "…-send-confirm"): sending now also books the invoice
  // as final, so anyone who dismissed the older, lighter warning must still see
  // this stronger one at least once.
  const SKIP_SEND_CONFIRM_KEY = "sipomax-skip-invoice-finalize-confirm";

  // Fortnox invoices only accept a Code from the account's own predefined
  // payment-terms registry, not an arbitrary day count — fetch the real
  // options instead of guessing at a fixed list.
  const [paymentTermOptions, setPaymentTermOptions] = useState<Array<{ code: string; numberOfDays: number | null }>>([]);
  const [paymentTermsError, setPaymentTermsError] = useState<string | null>(null);
  useEffect(() => {
    fetchPaymentTerms()
      .then((r) => { setPaymentTermOptions(r.terms); setPaymentTermsError(null); })
      .catch((err: any) => {
        setPaymentTermOptions([]);
        // Most likely cause: the stored Fortnox connection predates the
        // "settings" OAuth scope this endpoint needs — only a reconnect in
        // Settings grants it, Fortnox won't add it to an existing token.
        setPaymentTermsError(err?.message ?? "Kunde inte hämta betalningsvillkor från Fortnox");
      });
  }, []);

  // Company profile completeness — a sent invoice shows these details, so warn
  // up front (with a link to Settings) if any required field is missing.
  const [companyMissing, setCompanyMissing] = useState<string[]>([]);
  useEffect(() => {
    fetchCompanyStatus()
      .then((r) => setCompanyMissing(r.complete ? [] : r.missing))
      .catch(() => { /* non-fatal — the send action still enforces this server-side */ });
  }, []);

  const [lines, setLines] = useState<ArticleLine[]>(() => {
    if (Array.isArray(job.invoice_articles) && job.invoice_articles.length) {
      return job.invoice_articles.map(normalizeArticleLine);
    }
    return confirmedOfferArticles(updates);
  });

  // Track which approved-offer status_update ids already contributed lines to
  // the invoice, so a newly approved offer can be appended without re-adding
  // (or fighting the user over) offers already reflected in `lines` — whether
  // the user kept, edited, or deliberately removed those lines. Seeded from
  // whatever is confirmed at mount, since the initial `lines` value (saved
  // invoice_articles or a fresh computation) already accounts for those.
  const processedOfferIdsRef = useRef<Set<string>>(new Set(confirmedOfferUpdates(updates).map((u: any) => u.id)));

  // New offers can be approved at any point while the invoice hasn't been sent
  // yet (customer approval, or a workshop pre-approval, can land after this tab
  // is already open). Whenever that happens, append just the new offer's lines
  // — never touch lines already on the invoice — so nothing the user edited or
  // removed gets clobbered, but nothing newly approved is silently dropped.
  useEffect(() => {
    if (isSentToCustomer) return;
    const confirmed = confirmedOfferUpdates(updates);
    const newOnes = confirmed.filter((u: any) => !processedOfferIdsRef.current.has(u.id));
    if (!newOnes.length) return;
    for (const u of newOnes) processedOfferIdsRef.current.add(u.id);
    const newLines = newOnes.flatMap(articleLinesForOffer);
    if (newLines.length) setLines((cur) => [...cur, ...newLines]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updates, isSentToCustomer]);

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDays = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();

  const [overrides, setOverrides] = useState({
    customerNumber: (job.fortnox_customer_number as string | null) ?? null,
    customerName: job.customer_name || "",
    address: job.billing_address || "",
    zipCode: job.billing_postal_code ? String(job.billing_postal_code) : "",
    city: job.billing_city || "",
    invoiceDate: today,
    dueDate: thirtyDays,
    ourReference: job.registration_number || String(jobId).slice(0, 8),
    // "Er referens" is the contact person, not the billing name — prefer the
    // customer's own first/last name, and only fall back to the company name
    // when there's no personal name on file.
    yourReference:
      [job.customer_first_name, job.customer_last_name].filter(Boolean).join(" ").trim() ||
      job.customer_company_name ||
      job.customer_name ||
      "",
    paymentTerms: "30",
  });
  const setOv = (k: keyof typeof overrides) => (v: string) => setOverrides(p => ({ ...p, [k]: v }));

  // --- Payment terms ↔ due date -------------------------------------------
  // The due date must follow the payment term: picking "10 dagar" should move
  // the förfallodatum to invoiceDate + 10. A ref keeps the latest term registry
  // available inside async callbacks without stale closures.
  const paymentTermOptionsRef = useRef(paymentTermOptions);
  paymentTermOptionsRef.current = paymentTermOptions;
  function addDaysISO(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const applyPaymentTerm = useCallback((code: string) => {
    setOverrides(p => {
      const days = paymentTermOptionsRef.current.find(o => o.code === code)?.numberOfDays ?? null;
      return { ...p, paymentTerms: code, ...(days != null ? { dueDate: addDaysISO(p.invoiceDate, days) } : {}) };
    });
  }, []);
  // Recompute the due date when the invoice date changes, keeping the term.
  const setInvoiceDate = useCallback((v: string) => {
    setOverrides(p => {
      const days = paymentTermOptionsRef.current.find(o => o.code === p.paymentTerms)?.numberOfDays ?? null;
      return { ...p, invoiceDate: v, ...(days != null ? { dueDate: addDaysISO(v, days) } : {}) };
    });
  }, []);
  // Free-text fallback (used only when the Fortnox term registry can't be
  // loaded): a plain day count still moves the due date accordingly.
  const setManualPaymentTerms = useCallback((v: string) => {
    setOverrides(p => {
      const n = Number(v);
      return { ...p, paymentTerms: v, ...(v.trim() && !isNaN(n) && n > 0 ? { dueDate: addDaysISO(p.invoiceDate, n) } : {}) };
    });
  }, []);

  // Pull the linked customer's default payment terms from Fortnox once on load
  // (Fortnox → Sipomax), unless the invoice has already been sent/frozen.
  const termsPrefilledRef = useRef(false);
  useEffect(() => {
    if (termsPrefilledRef.current || isSent) return;
    const num = overrides.customerNumber;
    if (!num) return;
    termsPrefilledRef.current = true;
    fetchCustomerDefaults({ data: { customerNumber: num } })
      .then((r) => { if (r.termsOfPayment) applyPaymentTerm(r.termsOfPayment); })
      .catch(() => { /* non-fatal — keep the default term */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides.customerNumber, isSent]);

  // Keep customer-derived invoice fields in sync when the customer is edited
  // anywhere (this tab, another job sharing the same Fortnox customer, etc.)
  // and the job refetches. Only touches a field when its underlying source
  // data actually changed AND the user hasn't since typed a manual override
  // away from the last auto-filled value — otherwise an unrelated refetch
  // (e.g. a new chat message) would clobber a deliberate edit. Frozen once
  // the invoice has been sent, since that document must not change after
  // the fact.
  const lastCustomerSyncRef = useRef({
    customerName: job.customer_name || "",
    address: job.billing_address || "",
    zipCode: job.billing_postal_code ? String(job.billing_postal_code) : "",
    city: job.billing_city || "",
    yourReference:
      [job.customer_first_name, job.customer_last_name].filter(Boolean).join(" ").trim() ||
      job.customer_company_name || job.customer_name || "",
  });
  useEffect(() => {
    if (isSent) return;
    const next = {
      customerName: job.customer_name || "",
      address: job.billing_address || "",
      zipCode: job.billing_postal_code ? String(job.billing_postal_code) : "",
      city: job.billing_city || "",
      yourReference:
        [job.customer_first_name, job.customer_last_name].filter(Boolean).join(" ").trim() ||
        job.customer_company_name || job.customer_name || "",
    };
    const last = lastCustomerSyncRef.current;
    setOverrides(p => {
      const merged = { ...p };
      (Object.keys(next) as Array<keyof typeof next>).forEach((k) => {
        if (next[k] !== last[k] && p[k] === last[k]) merged[k] = next[k];
      });
      return merged;
    });
    lastCustomerSyncRef.current = next;
  }, [job.customer_name, job.customer_first_name, job.customer_last_name, job.customer_company_name, job.billing_address, job.billing_postal_code, job.billing_city, isSent]);

  const [editingCust, setEditingCust] = useState(false);
  const [savingCust, setSavingCust] = useState(false);
  const [custEditForm, setCustEditForm] = useState({
    customer_company_name: job.customer_company_name ?? "",
    // Only fall back to splitting customer_name into first/last when there's
    // no company name — otherwise customer_name IS the company name and
    // splitting it would fabricate a fake contact person.
    customer_first_name: job.customer_first_name ?? (job.customer_company_name ? "" : job.customer_name?.split(/\s+/)[0] ?? ""),
    customer_last_name: job.customer_last_name ?? (job.customer_company_name ? "" : job.customer_name?.split(/\s+/).slice(1).join(" ") ?? ""),
    customer_phone: job.customer_phone ?? "",
    customer_email: job.customer_email ?? "",
    customer_org_number: job.customer_org_number ?? "",
    billing_address: job.billing_address ?? "",
    billing_postal_code: job.billing_postal_code ?? "",
    billing_city: job.billing_city ?? "",
  });
  const [missingAddress, setMissingAddress] = useState(false);

  const [custQuery, setCustQuery] = useState("");
  const [allCustomers, setAllCustomers] = useState<Array<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }>>([]);
  const [custResults, setCustResults] = useState<Array<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }>>([]);
  const [searchingCust, setSearchingCust] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [showCreateCust, setShowCreateCust] = useState(false);
  const [creatingCust, setCreatingCust] = useState(false);
  const [createCustForm, setCreateCustForm] = useState({ name: "", email: "", phone: "", address: "", zipCode: "", city: "" });
  const [createCustDuplicate, setCreateCustDuplicate] = useState<{ customerNumber: string; name: string; email?: string } | null>(null);
  const custDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allCustFetched = useRef(false);
  const custBoxRef = useRef<HTMLDivElement | null>(null);

  const RECENT_CUSTOMERS_KEY = "fortnox-recent-customers";
  function getRecentCustNums(): string[] {
    try { return JSON.parse(localStorage.getItem(RECENT_CUSTOMERS_KEY) ?? "[]"); } catch { return []; }
  }
  function addRecentCust(num: string) {
    const recent = getRecentCustNums().filter((n) => n !== num);
    recent.unshift(num);
    localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(recent.slice(0, 10)));
  }
  function sortCustByRecent(list: typeof allCustomers): typeof allCustomers {
    const recent = getRecentCustNums();
    if (!recent.length) return list;
    const recentSet = new Set(recent);
    const recentOnes = recent.map((n) => list.find((c) => c.customerNumber === n)).filter(Boolean) as typeof allCustomers;
    const rest = list.filter((c) => !recentSet.has(c.customerNumber));
    return [...recentOnes, ...rest];
  }

  const fetchAllCustomers = useCallback(async () => {
    if (allCustFetched.current) {
      setCustResults(sortCustByRecent(allCustomers));
      setCustOpen(true);
      return;
    }
    setSearchingCust(true);
    try {
      const r = await searchCustomers({ data: { query: "" } });
      allCustFetched.current = true;
      setAllCustomers(r.results);
      setCustResults(sortCustByRecent(r.results));
      setCustOpen(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Kundsökning misslyckades");
    } finally {
      setSearchingCust(false);
    }
  }, [allCustomers, searchCustomers]);

  useEffect(() => {
    if (custDebounceRef.current) clearTimeout(custDebounceRef.current);
    const q = custQuery.trim();
    if (allCustFetched.current) {
      const ranked = q
        ? rankCustomers(allCustomers, q, getRecentCustNums()).slice(0, 100)
        : sortCustByRecent(allCustomers);
      setCustResults(ranked);
      setCustOpen(true);
      return;
    }
    if (!q) return;
    custDebounceRef.current = setTimeout(async () => {
      setSearchingCust(true);
      try {
        const r = await searchCustomers({ data: { query: custQuery } });
        setCustResults(sortCustByRecent(r.results));
        setCustOpen(true);
      } catch (err: any) {
        setCustResults([]);
        toast.error(err?.message ?? "Kundsökning misslyckades");
      } finally {
        setSearchingCust(false);
      }
    }, 200);
    return () => { if (custDebounceRef.current) clearTimeout(custDebounceRef.current); };
  }, [custQuery, allCustomers]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (custBoxRef.current && !custBoxRef.current.contains(e.target as Node)) setCustOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function selectCustomer(c: { customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }) {
    addRecentCust(c.customerNumber);
    // "Byt kund" just repoints the job at a different customer. Replace every
    // customer field with the picked customer's values (empty when it has none)
    // — never keep the previous customer's data, or it leaks onto this invoice.
    //
    // Fortnox has a single Name field; `personalName` (tracked by Sipomax) is
    // set only when that Name is a company, in which case it holds the contact
    // person. "Er referens" is the contact person, so use personalName for a
    // company and the plain name for an individual.
    const companyName = c.personalName ? c.name : "";
    const personalName = companyName ? (c.personalName ?? "") : c.name;
    setOverrides(p => ({
      ...p,
      customerNumber: c.customerNumber,
      customerName: c.name,
      yourReference: personalName || companyName || c.name,
      address: c.address ?? "",
      zipCode: c.zipCode ?? "",
      city: c.city ?? "",
    }));
    setCustEditForm(f => ({
      ...f,
      customer_company_name: companyName,
      customer_first_name: personalName.split(/\s+/)[0] ?? "",
      customer_last_name: personalName.split(/\s+/).slice(1).join(" ") ?? "",
      customer_phone: c.phone ?? "",
      customer_email: c.email ?? "",
      customer_org_number: c.orgNumber ?? "",
      billing_address: c.address ?? "",
      billing_postal_code: c.zipCode ?? "",
      billing_city: c.city ?? "",
    }));
    setCustQuery(`${c.name} (#${c.customerNumber})`);
    setCustResults([]);
    setCustOpen(false);
    setShowCreateCust(false);
    setEditingCust(false);
    // Adopt the newly linked customer's default payment terms from Fortnox
    // (Fortnox → Sipomax), which also recomputes the due date.
    if (c.customerNumber) {
      fetchCustomerDefaults({ data: { customerNumber: c.customerNumber } })
        .then((r) => { if (r.termsOfPayment) applyPaymentTerm(r.termsOfPayment); })
        .catch(() => { /* non-fatal — keep the current term */ });
    }
  }

  function checkCustDuplicate(name: string, email: string) {
    const lowerName = name.trim().toLowerCase();
    const lowerEmail = email.trim().toLowerCase();
    const match = allCustomers.find((c) =>
      c.name.toLowerCase() === lowerName ||
      (lowerEmail && c.email?.toLowerCase() === lowerEmail),
    );
    setCreateCustDuplicate(match ? { customerNumber: match.customerNumber, name: match.name, email: match.email } : null);
    return match ?? null;
  }

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (createCustDuplicate) {
      toast.error(`En kund med det namnet finns redan i Fortnox (kundnr ${createCustDuplicate.customerNumber}). Välj den istället.`);
      return;
    }
    setCreatingCust(true);
    try {
      const result = await createCust({ data: createCustForm });
      if (result.alreadyExists) {
        toast.error(`En kund med det namnet finns redan i Fortnox (kundnr ${result.customerNumber}). Välj den istället.`);
        return;
      }
      toast.success(`Kund skapad i Fortnox (kundnr ${result.customerNumber})`);
      addRecentCust(result.customerNumber);
      allCustFetched.current = false;
      setOverrides(p => ({
        ...p,
        customerNumber: result.customerNumber,
        customerName: createCustForm.name,
        yourReference: createCustForm.name,
        address: createCustForm.address || p.address,
        zipCode: createCustForm.zipCode || p.zipCode,
        city: createCustForm.city || p.city,
      }));
      setCustQuery(`${createCustForm.name} (#${result.customerNumber})`);
      setShowCreateCust(false);
      setCreateCustDuplicate(null);
      setCustResults([]);
      setCustOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte skapa kund");
    } finally {
      setCreatingCust(false);
    }
  }

  async function saveCustEdit() {
    setSavingCust(true);
    try {
      const companyName = custEditForm.customer_company_name.trim();
      const resolvedName = companyName || [custEditForm.customer_first_name.trim(), custEditForm.customer_last_name.trim()].filter(Boolean).join(" ");
      // Update only THIS job's snapshot. Sibling jobs sharing this customer are
      // frozen historical records and must not change — the current customer
      // truth lives on the Kunder page (and in Fortnox), not on old jobs.
      await saveBilling({ data: { job_id: jobId, ...custEditForm, customer_name: resolvedName } });
      if (overrides.customerNumber) {
        // Push the same edit to the customer record in Fortnox (and its cache),
        // so the Kunder page and future jobs see the up-to-date details. Send
        // every field (even when cleared) so emptying one actually removes it;
        // the name is the exception — a customer must keep one, so only a
        // non-empty resolved name is pushed.
        await updateCust({ data: {
          customerNumber: overrides.customerNumber,
          ...(resolvedName ? { name: resolvedName } : {}),
          phone: custEditForm.customer_phone,
          email: custEditForm.customer_email,
          orgNumber: custEditForm.customer_org_number,
          address: custEditForm.billing_address,
          zipCode: custEditForm.billing_postal_code,
          city: custEditForm.billing_city,
        } });
      }
      const resolvedYourReference =
        [custEditForm.customer_first_name, custEditForm.customer_last_name].filter(Boolean).join(" ").trim() ||
        companyName ||
        resolvedName;
      setOverrides(p => ({
        ...p,
        customerName: resolvedName || p.customerName,
        yourReference: resolvedYourReference || p.yourReference,
        address: custEditForm.billing_address,
        zipCode: custEditForm.billing_postal_code,
        city: custEditForm.billing_city,
      }));
      setMissingAddress(false);
      setEditingCust(false);
      toast.success("Kunduppgifter sparade");
      // Refetch this job so every panel showing its customer data reflects the
      // edit immediately. Other jobs are left untouched by design.
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte spara kunduppgifter");
    } finally {
      setSavingCust(false);
    }
  }

  const [previewData, setPreviewData] = useState<{ invoiceId: string; invoice: any; pdfBase64?: string } | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "book" | "send" | "book_send">("");

  const [invoicePdfBusy, setInvoicePdfBusy] = useState(false);

  // Opens the finished invoice. The popup tab must open a REAL https URL:
  // opening an empty tab and document.write-ing a spinner into it kills the
  // current page on iOS Safari (traced via client_diagnostics: pagehide fires
  // ~100ms after window.open and the app reloads). The invoice endpoint
  // re-renders the PDF from the job's frozen snapshot and redirects to a
  // signed Storage URL, so the tab lands in the browser's native PDF viewer —
  // the little in-app browser on mobile.
  async function handleOpenInvoicePdf() {
    traceInvoiceOpen("open:start", `job=${jobId}`);
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
    // in the in-app viewer instead (same pipeline, no tab involved).
    setInvoicePdfBusy(true);
    try {
      traceInvoiceOpen("open:fetching (no-token fallback)");
      const r = await openFinalPdf({ data: { job_id: jobId } });
      traceInvoiceOpen("open:fetched", `pdf=${r.pdf_base64 ? `${r.pdf_base64.length} chars` : "EMPTY"}`);
      if (r.pdf_base64) {
        traceInvoiceOpen("open:show-inline-viewer");
        setPreviewData({ invoiceId: r.invoice_id, invoice: null, pdfBase64: r.pdf_base64 });
      } else {
        toast.error("Kunde inte generera PDF");
      }
      traceInvoiceOpen("open:done");
    } catch (err: any) {
      traceInvoiceOpen("open:error", err?.message ?? err);
      toast.error(err?.message ?? "Kunde inte öppna fakturan");
    } finally {
      setInvoicePdfBusy(false);
    }
  }

  // Once the invoice has been sent to the customer it has also been booked as
  // final in Fortnox (sending does both in one step), so nothing remains but to
  // view the archived PDF.
  if (isSentToCustomer) {
    const invoiceId = job.fortnox_invoice_id ?? job.visma_invoice_id;
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={handleOpenInvoicePdf}
          disabled={invoicePdfBusy}
          className="flex w-full min-w-0 items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors px-5 py-4 text-left disabled:opacity-50"
        >
          <div className="h-11 w-11 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            {invoicePdfBusy
              ? <Loader2 className="h-5 w-5 text-emerald-700 animate-spin" />
              : <Receipt className="h-5 w-5 text-emerald-700" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-800">
              {invoicePdfBusy ? "Öppnar…" : "Öppna / ladda ner faktura (PDF)"}
            </p>
            {invoiceId && (
              <p className="text-xs text-emerald-700/80 mt-0.5">Faktura #{invoiceId}</p>
            )}
          </div>
        </button>
        {/* Fallback viewer for jobs without portal credentials */}
        {previewData?.pdfBase64 && (
          <InvoicePdfPreview
            pdfBase64={previewData.pdfBase64}
            invoiceId={previewData.invoiceId}
            invoice={previewData.invoice}
          />
        )}
      </div>
    );
  }

  async function handlePreview() {
    if (lines.length === 0) {
      toast.error("Lägg till minst en artikel");
      return;
    }
    setBusy("preview");
    // Open synchronously (before any await) so popup blockers don't intervene,
    // then immediately write a styled loading page so the tab isn't blank.
    const newTab = window.open("", "_blank");
    if (newTab) {
      newTab.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Genererar förhandsgranskning…</title><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f4f4f5;font-family:system-ui,sans-serif;color:#52525b}.spinner{width:40px;height:40px;border:3px solid #e4e4e7;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:20px}@keyframes spin{to{transform:rotate(360deg)}}p{font-size:15px;font-weight:500}</style></head><body><div class="spinner"></div><p>Genererar förhandsgranskning…</p></body></html>`);
      newTab.document.close();
    }
    try {
      const r = await preview({ data: { job_id: jobId, articles: lines, overrides } });
      if (r.pdf_base64 && newTab) {
        const bytes = Uint8Array.from(atob(r.pdf_base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        newTab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else {
        newTab?.close();
        setPreviewData({ invoiceId: r.invoice_id, invoice: r.invoice, pdfBase64: r.pdf_base64 });
      }
      // "Förhandsgranska" no longer creates anything in Fortnox — it renders a
      // local draft (empty Fakturanr/OCR) until the invoice is booked or sent,
      // so there is nothing to clean up afterwards.
      toast.success(
        r.invoice_id
          ? `Förhandsgranskning klar – faktura #${r.invoice_id}`
          : "Förhandsgranskning klar (utkast)",
      );
    } catch (err: any) {
      newTab?.close();
      toast.error(err?.message ?? "Kunde inte förhandsgranska fakturan");
    } finally {
      setBusy("");
    }
  }

  async function savePhone(e?: React.SyntheticEvent) {
    e?.preventDefault();
    const phone = phoneInput.trim();
    if (!phone) return;
    setSavingPhone(true);
    try {
      await patchPhone({ data: { job_id: jobId, phone } });
      onDone();
      setPhoneInput("");
      setShowPhoneDialog(false);
      toast.success("Telefonnummer sparat");
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte spara telefonnummer");
    } finally {
      setSavingPhone(false);
    }
  }

  // "send" and "book_send" notify the customer by SMS, book the invoice as
  // final in Fortnox, and can't be undone — gate on having a phone number to
  // notify, and require an explicit confirmation first.
  function requestFinalize(action: "book" | "send" | "book_send") {
    const sendsToCustomer = action === "send" || action === "book_send";
    if (sendsToCustomer && !job.customer_phone?.trim()) {
      setShowPhoneDialog(true);
      return;
    }
    if (sendsToCustomer && localStorage.getItem(SKIP_SEND_CONFIRM_KEY) !== "true") {
      setPendingAction(action);
      setSkipSendConfirm(false);
      setShowSendConfirm(true);
      return;
    }
    handleFinalize(action);
  }

  function confirmSend() {
    if (skipSendConfirm) localStorage.setItem(SKIP_SEND_CONFIRM_KEY, "true");
    setShowSendConfirm(false);
    if (pendingAction) handleFinalize(pendingAction);
    setPendingAction(null);
  }

  async function handleFinalize(action: "book" | "send" | "book_send") {
    if (lines.length === 0) {
      toast.error("Lägg till minst en artikel");
      return;
    }
    if (!overrides.address || !overrides.zipCode || !overrides.city) {
      setMissingAddress(true);
      setEditingCust(true);
      toast.error("Fyll i kundens adressuppgifter innan du skapar fakturan");
      return;
    }
    setBusy(action);
    try {
      const r = await finalize({ data: { job_id: jobId, articles: lines, action, overrides } });
      const label = action === "book" ? "bokförd" : action === "send" ? "skickad" : "bokförd och skickad";
      toast.success(`Faktura #${r.invoiceId} ${label}.`);
      if (action === "book" || action === "book_send") setBookedLocally(true);
      if (action === "send" || action === "book_send") setSentLocally(true);
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte slutföra fakturan");
    } finally {
      setBusy("");
    }
  }

  const subtotal = articlesSubtotal(lines);
  const working = busy !== "";

  return (
    <div className="space-y-5">
      <Dialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lägg till telefonnummer</DialogTitle>
            <DialogDescription>
              Kundens mobilnummer saknas. Fakturan skickas med en SMS-avisering, så ett nummer krävs innan du kan skicka.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePhone} className="space-y-3 pt-1">
            <Input
              autoFocus
              type="tel"
              placeholder="07X XXX XX XX"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={savingPhone || !phoneInput.trim()}>
                {savingPhone ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Phone className="h-4 w-4 mr-2" />}
                Spara nummer
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => setShowPhoneDialog(false)}>Avbryt</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showSendConfirm} onOpenChange={(open) => { setShowSendConfirm(open); if (!open) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skicka och bokför fakturan?</AlertDialogTitle>
            <AlertDialogDescription>
              Den färdiga fakturan skickas till kunden och bokförs som en slutgiltig
              faktura i Fortnox. Inga fler offerter kan läggas till efter detta, och
              åtgärden går inte att ångra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-1">
            <Checkbox id="skip-send-confirm" checked={skipSendConfirm} onCheckedChange={(c) => setSkipSendConfirm(c === true)} />
            <label htmlFor="skip-send-confirm" className="text-sm text-muted-foreground cursor-pointer">Visa inte det här igen</label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSend}>Skicka och bokför</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {companyMissing.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">Företagsuppgifter saknas</p>
            <p className="text-amber-800/90 mt-0.5">
              Följande fält visas på fakturan och måste fyllas i innan du kan skicka den:{" "}
              <span className="font-medium">{companyMissing.join(", ")}</span>.
            </p>
            <Link to="/settings" className="inline-flex items-center gap-1 mt-1.5 font-medium underline">
              Uppdatera i Inställningar
            </Link>
          </div>
        </div>
      )}

      <div>
        <p className="text-base font-semibold">Faktura</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Raderna nedan kommer från godkända offerter. Lägg till eller ta bort artiklar och
          justera priser innan du skapar fakturan i Fortnox.
        </p>
      </div>

      {/* ── Invoice details ── */}
      <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fakturadetaljer</p>

        {/* Customer search + create — only for a job that isn't linked to a
            customer yet (e.g. legacy jobs). A job is locked to the customer it
            was created with; there's no way to swap it to a different one, so
            once it's linked this whole block disappears and only the "Redigera"
            panel (edit the current customer's details) remains. Also hidden once
            the invoice is sent — the job's details are then frozen. */}
        {!isSentToCustomer && !overrides.customerNumber && (
        <div className="space-y-1">
          <Label className="text-xs">Sök befintlig Fortnox-kund</Label>
          <div ref={custBoxRef} className="relative">
            <Input
              value={custQuery}
              onChange={e => setCustQuery(e.target.value)}
              onFocus={() => { if (!custOpen) fetchAllCustomers(); }}
              placeholder="Namn, telefon, e-post, org.nr…"
              className="h-8 text-sm"
            />
            {searchingCust && (
              <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {custOpen && (custResults.length > 0 || searchingCust) && (
              <div className="absolute z-30 mt-1 w-full rounded-md border bg-popover shadow-md flex flex-col max-h-[50dvh] sm:max-h-60">
                <div className="overflow-y-auto overscroll-contain flex-1">
                  {searchingCust && custResults.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">Söker…</p>
                  ) : (
                    custResults.map(c => {
                      const isRecent = getRecentCustNums().includes(c.customerNumber);
                      return (
                        <button
                          key={c.customerNumber}
                          type="button"
                          className="w-full text-left px-3 py-2.5 sm:py-2 hover:bg-muted active:bg-muted/80 flex items-center gap-2"
                          onClick={() => selectCustomer(c)}
                        >
                          {isRecent && <Clock className="h-3 w-3 text-muted-foreground shrink-0" />}
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs text-muted-foreground"># {c.customerNumber}{c.city ? ` · ${c.city}` : ""}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setCreateCustForm(f => ({ ...f, name: custQuery })); setShowCreateCust(true); setCustOpen(false); }}
                  className="w-full text-left px-3 py-2.5 sm:py-2 hover:bg-muted active:bg-muted/80 flex items-center gap-1.5 text-primary border-t shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" /><span className="text-sm font-medium">Skapa ny kund i Fortnox</span>
                </button>
              </div>
            )}
          </div>
          {custQuery.trim() && !searchingCust && custResults.length === 0 && !showCreateCust && !custOpen && (
            <button
              type="button"
              onClick={() => { setCreateCustForm(f => ({ ...f, name: custQuery })); setShowCreateCust(true); }}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium pt-1"
            >
              <Plus className="h-3.5 w-3.5" /> Skapa ny kund i Fortnox
            </button>
          )}
        </div>
        )}

        {/* Inline create-customer form — reachable only from the search block
            above, so it's implicitly limited to not-yet-linked, not-yet-sent
            jobs too. */}
        {!isSentToCustomer && !overrides.customerNumber && showCreateCust && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ny kund i Fortnox</p>
              <button type="button" onClick={() => { setShowCreateCust(false); setCreateCustDuplicate(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <form onSubmit={handleCreateCustomer} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Namn *</Label>
                  <Input
                    required
                    value={createCustForm.name}
                    onChange={e => { const v = e.target.value; setCreateCustForm(f => ({ ...f, name: v })); checkCustDuplicate(v, createCustForm.email); }}
                    className={`h-8 text-sm ${createCustDuplicate ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    placeholder="Företagets- eller personnamn"
                  />
                  {createCustDuplicate && (
                    <p className="text-xs text-destructive">En kund med det namnet finns redan (#{createCustDuplicate.customerNumber}).</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">E-post</Label>
                  <Input type="email" value={createCustForm.email} onChange={e => { const v = e.target.value; setCreateCustForm(f => ({ ...f, email: v })); checkCustDuplicate(createCustForm.name, v); }} className="h-8 text-sm" placeholder="kund@exempel.se" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Telefon</Label>
                  <Input value={createCustForm.phone} onChange={e => setCreateCustForm(f => ({ ...f, phone: e.target.value }))} className="h-8 text-sm" placeholder="070-123 45 67" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Adress</Label>
                  <Input value={createCustForm.address} onChange={e => setCreateCustForm(f => ({ ...f, address: e.target.value }))} className="h-8 text-sm" placeholder="Gatuadress" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Postnummer</Label>
                  <Input value={createCustForm.zipCode} onChange={e => setCreateCustForm(f => ({ ...f, zipCode: e.target.value }))} className="h-8 text-sm" placeholder="123 45" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Stad</Label>
                  <Input value={createCustForm.city} onChange={e => setCreateCustForm(f => ({ ...f, city: e.target.value }))} className="h-8 text-sm" placeholder="Stockholm" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm" disabled={creatingCust} className="flex-1">
                  {creatingCust ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                  Skapa kund
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowCreateCust(false)}>Avbryt</Button>
              </div>
            </form>
          </div>
        )}

        {/* Selected customer chip + edit panel */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {overrides.customerNumber && <span className="text-muted-foreground text-xs mr-1">#{overrides.customerNumber} ·</span>}
                {overrides.customerName || <span className="text-muted-foreground italic">Ingen kund vald</span>}
              </p>
              {!editingCust && overrides.address && (
                <p className="text-xs text-muted-foreground truncate">{overrides.address}{overrides.zipCode ? `, ${overrides.zipCode}` : ""}{overrides.city ? ` ${overrides.city}` : ""}</p>
              )}
              {missingAddress && !editingCust && (
                <p className="text-xs text-destructive mt-0.5">Adress saknas — krävs för faktura</p>
              )}
            </div>
            {isSentToCustomer ? (
              <span className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground" title="Fakturan är skickad – uppgifterna är låsta">
                <Lock className="h-3 w-3" /> Låst
              </span>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="shrink-0 h-7 px-2 text-xs" onClick={() => setEditingCust(e => !e)}>
                <Pencil className="h-3 w-3 mr-1" />{editingCust ? "Stäng" : "Redigera"}
              </Button>
            )}
          </div>

          {editingCust && !isSentToCustomer && (
            <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Företagsnamn (valfritt)</Label>
                <Input className="h-8 text-sm" value={custEditForm.customer_company_name}
                  onChange={e => setCustEditForm(f => ({ ...f, customer_company_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Förnamn</Label>
                <Input className="h-8 text-sm" value={custEditForm.customer_first_name}
                  onChange={e => setCustEditForm(f => ({ ...f, customer_first_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Efternamn</Label>
                <Input className="h-8 text-sm" value={custEditForm.customer_last_name}
                  onChange={e => setCustEditForm(f => ({ ...f, customer_last_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefon</Label>
                <Input className="h-8 text-sm" value={custEditForm.customer_phone}
                  onChange={e => setCustEditForm(f => ({ ...f, customer_phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">E-post</Label>
                <Input type="email" className="h-8 text-sm" value={custEditForm.customer_email}
                  onChange={e => setCustEditForm(f => ({ ...f, customer_email: e.target.value }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Org.nr / personnummer</Label>
                <Input className="h-8 text-sm" value={custEditForm.customer_org_number}
                  onChange={e => setCustEditForm(f => ({ ...f, customer_org_number: e.target.value }))} />
              </div>
              <div className={`space-y-1 col-span-2 ${missingAddress && !custEditForm.billing_address ? "ring-1 ring-destructive rounded-md p-1" : ""}`}>
                <Label className="text-xs">Adress {missingAddress && !custEditForm.billing_address && <span className="text-destructive">*</span>}</Label>
                <Input className="h-8 text-sm" value={custEditForm.billing_address}
                  onChange={e => setCustEditForm(f => ({ ...f, billing_address: e.target.value }))} />
              </div>
              <div className={`space-y-1 ${missingAddress && !custEditForm.billing_postal_code ? "ring-1 ring-destructive rounded-md p-1" : ""}`}>
                <Label className="text-xs">Postnummer {missingAddress && !custEditForm.billing_postal_code && <span className="text-destructive">*</span>}</Label>
                <Input className="h-8 text-sm" value={custEditForm.billing_postal_code}
                  onChange={e => setCustEditForm(f => ({ ...f, billing_postal_code: e.target.value }))} />
              </div>
              <div className={`space-y-1 ${missingAddress && !custEditForm.billing_city ? "ring-1 ring-destructive rounded-md p-1" : ""}`}>
                <Label className="text-xs">Ort {missingAddress && !custEditForm.billing_city && <span className="text-destructive">*</span>}</Label>
                <Input className="h-8 text-sm" value={custEditForm.billing_city}
                  onChange={e => setCustEditForm(f => ({ ...f, billing_city: e.target.value }))} />
              </div>
              <div className="col-span-2 flex gap-2 pt-1">
                <Button type="button" size="sm" onClick={saveCustEdit} disabled={savingCust}>
                  {savingCust ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  Spara
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingCust(false)}>Avbryt</Button>
              </div>
            </div>
          )}
        </div>

        {/* Date + reference fields. Single column on narrow screens — native
            type="date" inputs have a wide intrinsic min-content size that
            overflows a 2-up grid column on mobile; min-w-0 on each cell is
            a secondary safeguard. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1 min-w-0">
            <Label className="text-xs">Fakturadatum</Label>
            <Input type="date" value={overrides.invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="h-8 text-sm w-full min-w-0" />
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-xs">Förfallodatum</Label>
            <Input type="date" value={overrides.dueDate} onChange={e => setOv("dueDate")(e.target.value)} className="h-8 text-sm w-full min-w-0" />
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-xs">Betalningsvillkor</Label>
            {paymentTermOptions.length > 0 ? (
              <Select value={overrides.paymentTerms} onValueChange={applyPaymentTerm}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Välj villkor" />
                </SelectTrigger>
                <SelectContent>
                  {paymentTermOptions.map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.code}{t.numberOfDays != null ? ` — ${t.numberOfDays} dagar` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input value={overrides.paymentTerms} onChange={e => setManualPaymentTerms(e.target.value)} className="h-8 text-sm" placeholder="30" />
                {paymentTermsError && (
                  <p className="text-[11px] text-amber-600">
                    Kunde inte hämta Fortnox betalningsvillkor — anslutningen saknar troligen behörighet. Återanslut Fortnox under Inställningar.
                  </p>
                )}
              </>
            )}
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-xs">Vår referens</Label>
            <Input value={overrides.ourReference} onChange={e => setOv("ourReference")(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-xs">Er referens</Label>
            <Input value={overrides.yourReference} onChange={e => setOv("yourReference")(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>
      </div>

      <ArticlePicker value={lines} onChange={setLines} />

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 pt-1">
        {/* Preview writes to the Fortnox invoice — after booking, the invoice
            is immutable and that path would create a duplicate. Once booked,
            there's also nothing left to preview: open the archived PDF that
            was saved at booking time instead of hitting Fortnox at all. */}
        {isBookkept ? (
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={handleOpenInvoicePdf} disabled={invoicePdfBusy}>
            {invoicePdfBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
            {invoicePdfBusy ? "Öppnar…" : "Öppna faktura"}
          </Button>
        ) : (
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={handlePreview} disabled={working || lines.length === 0}>
            {busy === "preview" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
            Förhandsgranska faktura
          </Button>
        )}
      </div>

      {(previewData?.pdfBase64 || previewData?.invoice) && (
        <InvoicePdfPreview
          pdfBase64={previewData.pdfBase64}
          invoiceId={previewData.invoiceId}
          invoice={previewData.invoice}
        />
      )}

      <div className="border-t pt-4">
        <p className="text-sm font-semibold mb-2">Slutför ({formatSek(subtotal)} kr exkl. moms)</p>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
          {/* A single action: sending the invoice also books it as final in
              Fortnox. There's no separate "Bokför" step anymore. The rare
              legacy invoice that was already booked (via the old flow) but
              never sent falls back to a plain "send". */}
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => requestFinalize(isBookkept ? "send" : "book_send")}
            disabled={working || lines.length === 0}
          >
            {busy === "send" || busy === "book_send"
              ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              : <SendHorizontal className="h-4 w-4 mr-1.5" />}
            Skicka faktura
          </Button>
        </div>
        {isBookkept && (
          <p className="text-xs text-muted-foreground mt-2">
            Fakturan är redan bokförd i Fortnox. Skicka den till kunden för att slutföra.
          </p>
        )}
      </div>
    </div>
  );
}

function InvoicePdfPreview({
  pdfBase64,
  invoiceId,
  invoice,
}: {
  pdfBase64?: string | null;
  invoiceId: string;
  invoice?: any;
}) {
  const blobUrlRef = useRef<string | null>(null);

  const getBlobUrl = useCallback(() => {
    if (!pdfBase64) return null;
    if (blobUrlRef.current) return blobUrlRef.current;
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    blobUrlRef.current = URL.createObjectURL(blob);
    return blobUrlRef.current;
  }, [pdfBase64]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [pdfBase64]);

  const handleDownload = useCallback(() => {
    const url = getBlobUrl();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `faktura-${invoiceId}.pdf`;
    a.click();
  }, [getBlobUrl, invoiceId]);

  const iframeSrc = pdfBase64 ? getBlobUrl() : null;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <p className="text-sm font-semibold">Faktura #{invoiceId}</p>
        {pdfBase64 && (
          <button
            onClick={handleDownload}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            Ladda ned PDF
          </button>
        )}
      </div>
      <div className="bg-gray-100 p-4">
        {iframeSrc ? (
          <iframe
            src={iframeSrc}
            className="w-full border-0 shadow-md"
            style={{ height: "1120px" }}
            title={`Faktura ${invoiceId}`}
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="shadow-md mx-auto" style={{ width: "794px" }}>
              <FortnoxInvoicePreview invoice={invoice ?? null} invoiceId={invoiceId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type NotesPanelProps = {
  notes: Note[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAdd: (title: string, content: string) => void;
  onEdit: (id: string, title: string, content: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
};

function NotesPanel({ notes, collapsed, onToggleCollapsed, onAdd, onEdit, onDelete, onTogglePin }: NotesPanelProps) {
  return (
    <Card className="sticky top-4">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Anteckningar</p>
        </div>
        <button
          onClick={onToggleCollapsed}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>
      {!collapsed && (
        <div className="p-3">
          <NotesContent notes={notes} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onTogglePin={onTogglePin} />
        </div>
      )}
    </Card>
  );
}

type NotesContentProps = {
  notes: Note[];
  onAdd: (title: string, content: string) => void;
  onEdit: (id: string, title: string, content: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
};

function NotesContent({ notes, onAdd, onEdit, onDelete, onTogglePin }: NotesContentProps) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");

  function commitNew() {
    if (newTitle.trim() || newContent.trim()) {
      onAdd(newTitle, newContent);
    }
    setAdding(false);
    setNewTitle("");
    setNewContent("");
  }

  const pinned = notes.filter((n) => n.pinned);
  const unpinned = notes.filter((n) => !n.pinned);
  const sorted = [...pinned, ...unpinned];

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => { setAdding(true); setNewTitle(""); setNewContent(""); }}
      >
        <Plus className="h-3.5 w-3.5" /> Ny anteckning
      </Button>

      {adding && (
        <div className="rounded-md border bg-card p-3 space-y-2">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Titel (valfri)"
            className="w-full text-sm font-semibold bg-transparent border-0 border-b border-border/50 pb-1 focus:outline-none focus:border-primary placeholder:text-muted-foreground/60 placeholder:font-normal"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Skriv din anteckning…"
            rows={3}
            className="w-full text-xs text-muted-foreground bg-transparent resize-none border-0 focus:outline-none placeholder:text-muted-foreground/50"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitNew(); }}
          />
          <div className="flex gap-2 justify-end pt-1 border-t border-border/40">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => { setAdding(false); setNewTitle(""); setNewContent(""); }}
            >
              Avbryt
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={commitNew}
            >
              Lägg till
            </Button>
          </div>
        </div>
      )}

      {sorted.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          onEdit={onEdit}
          onDelete={onDelete}
          onTogglePin={onTogglePin}
        />
      ))}

      {notes.length === 0 && !adding && (
        <div className="py-6 text-center">
          <p className="text-xs text-muted-foreground">Inga anteckningar än.</p>
        </div>
      )}

      <div className="flex items-start gap-1.5 pt-1 border-t border-border/40">
        <Lightbulb className="h-3 w-3 text-muted-foreground/60 mt-0.5 shrink-0" />
        <p className="text-[10px] text-muted-foreground/60 leading-snug">
          Fäst viktiga anteckningar högst upp genom att klicka på <Pin className="inline h-2.5 w-2.5" />.
        </p>
      </div>
    </div>
  );
}

function NoteCard({ note, onEdit, onDelete, onTogglePin }: {
  note: Note;
  onEdit: (id: string, title: string, content: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);

  function commit() {
    onEdit(note.id, title, content);
    setEditing(false);
  }

  // Keep local state in sync if parent updates (e.g. after refetch)
  useEffect(() => { setTitle(note.title); setContent(note.content); }, [note.title, note.content]);

  const dateStr = new Date(note.created_at).toLocaleString("sv-SE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className={`rounded-md border bg-card p-3 space-y-1.5 group ${note.pinned ? "border-primary/30 bg-primary/5" : ""}`}>
      <div className="flex items-start justify-between gap-1.5">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-sm font-semibold flex-1 bg-transparent border-0 border-b border-border/50 pb-0.5 focus:outline-none focus:border-primary min-w-0"
          />
        ) : (
          <p
            className="text-sm font-semibold flex-1 min-w-0 truncate cursor-text"
            onClick={() => setEditing(true)}
          >
            {note.title || "Anteckning"}
            {note.pinned && <Pin className="inline h-2.5 w-2.5 ml-1 text-primary" />}
          </p>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all shrink-0">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[140px]">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-2" /> Redigera
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTogglePin(note.id)}>
              {note.pinned
                ? <><PinOff className="h-3.5 w-3.5 mr-2" /> Ta bort fästning</>
                : <><Pin className="h-3.5 w-3.5 mr-2" /> Fäst högst upp</>
              }
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(note.id)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Radera
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="w-full text-xs text-muted-foreground bg-transparent resize-none border-0 focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); }}
          />
          <div className="flex gap-2 justify-end border-t border-border/40 pt-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
              onClick={() => { setTitle(note.title); setContent(note.content); setEditing(false); }}>
              Avbryt
            </Button>
            <Button type="button" size="sm" className="h-6 px-2.5 text-[11px]" onClick={commit}>
              Spara
            </Button>
          </div>
        </div>
      ) : (
        <p
          className="text-xs text-muted-foreground whitespace-pre-wrap break-words cursor-text min-h-[1rem]"
          onClick={() => setEditing(true)}
        >
          {note.content || <span className="opacity-50">Klicka för att skriva…</span>}
        </p>
      )}

      <p className="text-[10px] text-muted-foreground/50">{dateStr}</p>
    </div>
  );
}

