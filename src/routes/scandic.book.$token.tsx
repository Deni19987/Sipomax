import { createFileRoute } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getScandicBookingPage, submitScandicBooking } from "@/lib/scandic.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { CheckCircle2, Calendar as CalIcon, Clock } from "lucide-react";

export const Route = createFileRoute("/scandic/book/$token")({
  head: () => ({
    meta: [
      { title: "Boka tid" },
      { name: "description", content: "" },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "" },
      { property: "og:description", content: "" },
      { property: "og:type", content: "" },
      { property: "og:image", content: "" },
      { name: "twitter:card", content: "" },
      { name: "twitter:site", content: "" },
      { name: "twitter:title", content: "" },
      { name: "twitter:description", content: "" },
      { name: "twitter:image", content: "" },
    ],
  }),
  component: BookingPage,
});

function formatDateLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "short", day: "numeric", month: "short" }).format(dt);
}

function BookingPage() {
  useScrollTopOnMount();
  const { token } = Route.useParams();
  const fetchPage = useServerFn(getScandicBookingPage);
  const submit = useServerFn(submitScandicBooking);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["scandic-book", token],
    queryFn: () => fetchPage({ data: { token } }),
    retry: false,
  });

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ iso: string; label: string } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [question, setQuestion] = useState("");
  const [done, setDone] = useState(false);
  const [meetingType, setMeetingType] = useState<"zoom" | "meet" | "teams" | "in_person">("zoom");

  // Pre-fill the form from the lead once it loads, without clobbering anything
  // the visitor has already typed. (Done in an effect — not during render.)
  useEffect(() => {
    const lead = data?.lead;
    if (!lead) return;
    const leadName = lead.name, leadPhone = lead.phone, leadEmail = lead.email;
    if (leadName) setName((v) => v || leadName);
    if (leadPhone) setPhone((v) => v || leadPhone);
    if (leadEmail) setEmail((v) => v || leadEmail);
  }, [data?.lead]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Välj en tid");
      return submit({ data: { token, isoStart: selectedSlot.iso, name, email, phone, question: question || null, meetingType } });
    },
    onSuccess: () => {
      setDone(true);
      toast.success("Bokning bekräftad!");
    },
    onError: (e: Error) => {
      toast.error(e.message);
      refetch();
    },
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Laddar...</div>;
  }

  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Hittade inte länken.</div>;
  }

  const activeDate = selectedDate ?? data.selectedDateKey;
  const day = data.days.find((d) => d.dateKey === activeDate) ?? data.days[0];

  if (done || data.lead.status === "booked") {
    const startIso = data.booking
      ? new Date(data.booking.slotStart).toISOString()
      : selectedSlot?.iso;
    const endIso = startIso ? new Date(new Date(startIso).getTime() + 30 * 60_000).toISOString() : null;
    const effectiveType = (data.booking?.meetingType as "zoom" | "meet" | "teams" | "in_person" | undefined) ?? meetingType;
    const meetingLabel =
      effectiveType === "zoom" ? "Zoom" : effectiveType === "meet" ? "Google Meet" : effectiveType === "teams" ? "Microsoft Teams" : "Fysiskt möte";
    const titleText = `Genomgång ScandicReach (${meetingLabel})`;
    const descText =
      effectiveType === "in_person"
        ? "Vi hör av oss med detaljer om plats innan mötet."
        : `Vi skickar ${meetingLabel}-länken via e-post innan mötet.`;
    const fmtIcs = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const icsContent = startIso && endIso
      ? `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//ScandicReach//Booking//SV\nBEGIN:VEVENT\nUID:${token}-${fmtIcs(startIso)}@scandicreach\nDTSTAMP:${fmtIcs(new Date().toISOString())}\nDTSTART:${fmtIcs(startIso)}\nDTEND:${fmtIcs(endIso)}\nSUMMARY:${titleText}\nDESCRIPTION:${descText}\nEND:VEVENT\nEND:VCALENDAR`
      : "";
    const icsHref = icsContent ? `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}` : "#";
    const gcalHref = startIso && endIso
      ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titleText)}&dates=${fmtIcs(startIso)}/${fmtIcs(endIso)}&details=${encodeURIComponent(descText)}`
      : "#";
    const whenLabel = startIso
      ? new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Europe/Stockholm",
          weekday: "long", day: "numeric", month: "long",
          hour: "2-digit", minute: "2-digit",
        }).format(new Date(startIso))
      : null;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
            <h1 className="text-xl font-semibold">Tack — vi hörs!</h1>
            {whenLabel && (
              <p className="text-sm font-medium">
                Din tid: {whenLabel} ({meetingLabel})
              </p>
            )}
            <p className="text-sm text-muted-foreground">Du får en bekräftelse via SMS/e-post inom kort. Vi hör av oss på utsatt tid.</p>
            {startIso && (
              <div className="pt-4 space-y-2">
                <a href={gcalHref} target="_blank" rel="noreferrer" className="block">
                  <Button variant="outline" className="w-full">Lägg till i Google Kalender</Button>
                </a>
                <a href={icsHref} download="scandicreach-mote.ics" className="block">
                  <Button variant="outline" className="w-full">Lägg till i Apple Kalender / Outlook</Button>
                </a>
                <p className="text-xs text-muted-foreground pt-1">
                  ICS-filen öppnas direkt i din kalenderapp.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Boka en kort genomgång</h1>
          <p className="text-sm text-muted-foreground">ScandicReach · 30 minuter</p>
        </header>

        <Card>
          <CardContent className="p-4 sm:p-6 space-y-6">
            <div>
              <Label className="flex items-center gap-2 mb-3"><CalIcon className="h-4 w-4" /> Välj dag</Label>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {data.days.map((d) => {
                  const hasFree = d.slots.some((s) => s.available);
                  const isActive = d.dateKey === activeDate;
                  return (
                    <button
                      key={d.dateKey}
                      type="button"
                      disabled={!hasFree}
                      onClick={() => { setSelectedDate(d.dateKey); setSelectedSlot(null); }}
                      className={`shrink-0 px-3 py-2 rounded-md border text-sm transition-colors ${
                        isActive ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                      } ${!hasFree ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      {formatDateLabel(d.dateKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="flex items-center gap-2 mb-3"><Clock className="h-4 w-4" /> Välj tid</Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {day.slots.map((s) => (
                  <button
                    key={s.isoStart}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setSelectedSlot({ iso: s.isoStart, label: s.time })}
                    className={`px-3 py-2 rounded-md border text-sm transition-colors ${
                      selectedSlot?.iso === s.isoStart
                        ? "bg-primary text-primary-foreground border-primary"
                        : s.available
                        ? "hover:bg-muted"
                        : "opacity-30 cursor-not-allowed line-through"
                    }`}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            </div>

            {selectedSlot && (
              <form
                onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
                className="space-y-4 border-t pt-6"
              >
                <p className="text-sm">
                  Vald tid: <strong>{formatDateLabel(activeDate)} kl {selectedSlot.label}</strong>
                </p>
                <div>
                  <Label className="mb-2 block">Mötesform</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(["zoom", "meet", "teams", "in_person"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMeetingType(m)}
                        className={`px-3 py-2 rounded-md border text-sm transition-colors ${
                          meetingType === m ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                        }`}
                      >
                        {m === "zoom" ? "Zoom" : m === "meet" ? "Google Meet" : m === "teams" ? "Teams" : "Fysiskt möte"}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {meetingType === "in_person"
                      ? "Vi hör av oss med detaljer om plats innan mötet."
                      : "Vi skickar möteslänken via e-post innan mötet."}
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="name">Namn *</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
                  </div>
                  <div>
                    <Label htmlFor="email">E-post *</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={160} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="phone">Mobilnummer *</Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={40} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="q">Fråga (valfritt)</Label>
                    <Textarea id="q" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} placeholder="Något du undrar redan nu?" />
                  </div>
                </div>
                <Button type="submit" disabled={mut.isPending} className="w-full">
                  {mut.isPending ? "Bokar..." : "Bekräfta bokning"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <Toaster />
    </div>
  );
}