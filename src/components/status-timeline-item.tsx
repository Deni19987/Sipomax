import { Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import {
  statusIcon,
  statusLabel,
  statusDescription,
  statusTone,
  TONE_DOT,
  TONE_ICON,
} from "@/lib/status";

type Props = {
  status: string;
  createdAt: string;
  isLast?: boolean;
  jobId: string;
  updateId: string;
  hasDetails?: boolean;
  /** approval_state of the update — a responded quote renders in place as
      approved (green) or rejected (red) instead of adding a new timeline row. */
  approvalState?: string | null;
};

export function StatusTimelineItem({
  status,
  createdAt,
  isLast,
  jobId,
  updateId,
  hasDetails,
  approvalState,
}: Props) {
  const Icon = statusIcon(status, approvalState);
  const tone = statusTone(status, approvalState);
  const created = new Date(createdAt);

  const dateStr = created.toLocaleString("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const isQuote = status === "quote_sent";
  const quoteState =
    isQuote && (approvalState === "approved" || approvalState === "rejected") ? approvalState : null;

  return (
    <div className="relative flex gap-4">
      {/* Timeline rail */}
      <div className="relative flex flex-col items-center pt-5">
        <div className={`h-2.5 w-2.5 rounded-full ${TONE_DOT[tone]}`} />
        {!isLast && <div className="flex-1 w-px bg-border mt-2" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-6">
        <Link
          to="/jobs/$id/updates/$updateId"
          params={{ id: jobId, updateId }}
          className="group block rounded-lg -mx-2 px-2 py-3 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start gap-4">
            <div
              className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON[tone]}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm sm:text-base font-semibold text-foreground inline-flex items-center gap-2">
                  {statusLabel(status)}
                  {quoteState === "approved" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-0.5">
                      <CheckCircle2 className="h-3 w-3" /> Godkänd
                    </span>
                  )}
                  {quoteState === "rejected" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 text-[11px] font-semibold px-2 py-0.5">
                      <XCircle className="h-3 w-3" /> Avvisad
                    </span>
                  )}
                </p>
                <p className="hidden sm:block text-sm text-muted-foreground whitespace-nowrap">{dateStr}</p>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 line-clamp-2">
                {statusDescription(status, approvalState)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 sm:hidden">{dateStr}</p>
              {hasDetails && (
                <p className="text-xs text-primary mt-1.5 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Visa detaljer →
                </p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-4 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
          </div>
        </Link>
      </div>
    </div>
  );
}
