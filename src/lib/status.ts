import {
  FileText,
  ClipboardList,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Wrench,
  Flag,
  Circle,
  Car,
  KeyRound,
  Cog,
  Search,
  Receipt,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export type JobStatus =
  | "car_dropped_off"
  | "diagnosis_started"
  | "started_work"
  | "quote_sent"
  | "quote_approved"
  | "quote_rejected"
  | "in_progress"
  | "job_done"
  | "car_picked_up";

export const STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: "car_dropped_off", label: "Bil inlämnad" },
  { value: "diagnosis_started", label: "Felsökning påbörjad" },
  { value: "started_work", label: "Arbete påbörjat" },
  { value: "quote_sent", label: "Offert" },
  { value: "in_progress", label: "Pågående arbete" },
  { value: "job_done", label: "Jobb klart" },
  { value: "car_picked_up", label: "Bil upphämtad" },
];

export function statusLabel(s: string): string {
  switch (s) {
    case "order_received": return "Arbetsorder mottagen";
    case "job_created": return "Jobb skapat";
    case "car_dropped_off": return "Bil inlämnad";
    case "diagnosis_started": return "Felsökning påbörjad";
    case "started_work": return "Arbete påbörjat";
    case "quote_sent": return "Offert";
    case "quote_approved": return "Godkänd av kund";
    case "quote_rejected": return "Avvisad av kund";
    case "in_progress": return "Pågående arbete";
    case "job_done": return "Jobb klart";
    case "car_picked_up": return "Bil upphämtad";
    case "invoice_booked": return "Faktura bokförd";
    case "invoice_sent": return "Faktura skickad";
    default: return s;
  }
}

// Customer-facing labels — used in the customer portal only.
export function statusLabelCustomer(s: string): string {
  switch (s) {
    case "quote_approved": return "Godkänd kostnad";
    case "quote_rejected": return "Avvisad offert";
    // "skickad" is the workshop's perspective — the customer just receives
    // their invoice.
    case "invoice_sent": return "Faktura";
    default: return statusLabel(s);
  }
}

export function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "job_done":
    case "quote_approved":
    case "car_picked_up":
      return "default";
    case "quote_rejected":
      return "destructive";
    case "quote_sent":
      return "outline";
    default:
      return "secondary";
  }
}

// A quote (quote_sent) transforms in place when the customer responds: the
// timeline item keeps its name ("Offert") but its icon/tone/description flip
// to approved (green check) or rejected (red cross). Pass the update's
// approval_state as the second argument wherever a quote row is rendered.
export function statusIcon(s: string, approval?: string | null): LucideIcon {
  if (s === "quote_sent" && approval === "approved") return CheckCircle2;
  if (s === "quote_sent" && approval === "rejected") return XCircle;
  switch (s) {
    case "order_received": return ClipboardList;
    case "job_created": return ClipboardList;
    case "car_dropped_off": return Car;
    case "diagnosis_started": return Search;
    case "started_work": return Wrench;
    case "quote_sent": return AlertCircle;
    case "quote_approved": return CheckCircle2;
    case "quote_rejected": return XCircle;
    case "in_progress": return Cog;
    case "job_done": return Flag;
    case "car_picked_up": return KeyRound;
    case "invoice_booked": return BookOpen;
    case "invoice_sent": return Receipt;
    default: return Circle;
  }
}

// Generic description shown under the header — always visible, regardless of
// whether the workshop attached extra notes/photos.
export function statusDescription(s: string, approval?: string | null): string {
  if (s === "quote_sent" && approval === "approved") {
    return "Offerten är godkänd. Vi fortsätter med arbetet.";
  }
  if (s === "quote_sent" && approval === "rejected") {
    return "Offerten avvisades.";
  }
  switch (s) {
    case "order_received":
      return "Vi har tagit emot din arbetsorder och lagt in ditt ärende hos oss.";
    case "job_created":
      return "Ditt ärende har registrerats hos oss.";
    case "car_dropped_off":
      return "Din bil har tagits emot hos oss.";
    case "diagnosis_started":
      return "Vi har påbörjat felsökning och diagnostisering av ditt fordon.";
    case "started_work":
      return "Inledande inspektion klar. Vi påbörjar nu det rekommenderade arbetet.";
    case "quote_sent":
      return "Vi har hittat ytterligare arbete som behöver göras. Vi inväntar ditt godkännande.";
    case "quote_approved":
      return "Kostnaden är godkänd. Vi fortsätter nu med jobbet.";
    case "quote_rejected":
      return "Offerten avvisades.";
    case "in_progress":
      return "Arbete pågår just nu på ditt fordon.";
    case "job_done":
      return "Allt arbete är klart. Din bil är redo att hämtas.";
    case "car_picked_up":
      return "Du har hämtat upp din bil. Välkommen tillbaka!";
    case "invoice_sent":
      return "";
    default:
      return "";
  }
}

// Color tone per status — drives both the rail dot and the icon chip.
export type StatusTone = "info" | "warning" | "success" | "danger" | "muted";

export function statusTone(s: string, approval?: string | null): StatusTone {
  if (s === "quote_sent" && approval === "approved") return "success";
  if (s === "quote_sent" && approval === "rejected") return "danger";
  switch (s) {
    case "order_received":
    case "job_created":
    case "car_dropped_off":
    case "diagnosis_started":
    case "started_work":
    case "in_progress":
      return "info";
    case "quote_sent":
      return "warning";
    case "quote_approved":
    case "job_done":
    case "car_picked_up":
    case "invoice_booked":
    case "invoice_sent":
      return "success";
    case "quote_rejected":
      return "danger";
    default:
      return "muted";
  }
}

export const TONE_DOT: Record<StatusTone, string> = {
  info: "bg-blue-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-red-500",
  muted: "bg-muted-foreground",
};

export const TONE_ICON: Record<StatusTone, string> = {
  info: "bg-blue-50 text-blue-600",
  warning: "bg-amber-50 text-amber-600",
  success: "bg-emerald-50 text-emerald-600",
  danger: "bg-red-50 text-red-600",
  muted: "bg-muted text-muted-foreground",
};