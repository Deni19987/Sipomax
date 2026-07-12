import { createFileRoute } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  isScandicOwner,
  listScandicLeads,
  createScandicLead,
  updateScandicLead,
  deleteScandicLead,
  createManualScandicBooking,
} from "@/lib/scandic.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Phone, MessageSquare, ChevronDown, ChevronRight, Send, Trash2, Calendar, CalendarPlus, Copy } from "lucide-react";
import { BakomliggandeData } from "@/components/BakomliggandeData";

export const Route = createFileRoute("/_authenticated/scandic")({
  component: ScandicPage,
});

function ScandicPage() {
  useScrollTopOnMount();
  const checkOwner = useServerFn(isScandicOwner);
  const { data: gate, isLoading: gateLoading } = useQuery({
    queryKey: ["scandic-owner"],
    queryFn: () => checkOwner(),
  });

  if (gateLoading) return <main className="max-w-5xl mx-auto p-6 text-sm text-muted-foreground">Laddar...</main>;
  if (!gate?.allowed) {
    return <main className="max-w-5xl mx-auto p-6 text-sm text-muted-foreground">Den här sidan är inte tillgänglig för ditt konto.</main>;
  }
  return <ScandicInner />;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" });
}

function ScandicInner() {
  const fetchAll = useServerFn(listScandicLeads);
  const createLead = useServerFn(createScandicLead);
  const updateLead = useServerFn(updateScandicLead);
  const removeLead = useServerFn(deleteScandicLead);
  const manualBook = useServerFn(createManualScandicBooking);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["scandic-leads"],
    queryFn: () => fetchAll(),
  });

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Manual booking form state
  const [bPhone, setBPhone] = useState("");
  const [bName, setBName] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [bWhen, setBWhen] = useState("");
  const [bType, setBType] = useState<"zoom" | "meet" | "teams" | "in_person">("zoom");
  const [bookMsg, setBookMsg] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => createLead({ data: { phone, name: name || null } }),
    onSuccess: () => {
      toast.success("SMS skickat!");
      setPhone(""); setName("");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const manualMut = useMutation({
    mutationFn: () => {
      if (!bWhen) throw new Error("Välj datum och tid");
      return manualBook({
        data: {
          phone: bPhone,
          name: bName,
          email: bEmail || null,
          isoStart: new Date(bWhen).toISOString(),
          meetingType: bType,
        },
      });
    },
    onSuccess: (r) => {
      toast.success("Bokning skapad!");
      setBookMsg(r.message);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyBookMsg = async () => {
    if (!bookMsg) return;
    try {
      await navigator.clipboard.writeText(bookMsg);
      toast.success("Meddelandet kopierat!");
    } catch {
      toast.error("Kunde inte kopiera — markera och kopiera texten manuellt.");
    }
  };

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; name?: string | null; email?: string | null; status?: "pending" | "booked" | "cancelled"; opted_out?: boolean }) =>
      updateLead({ data: vars }),
    onSuccess: () => { toast.success("Sparat"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => removeLead({ data: { id } }),
    onSuccess: () => { toast.success("Borttagen"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ScandicReach utskick</h1>
        <p className="text-sm text-muted-foreground">Skicka bokningslänk via SMS och följ upp automatiskt.</p>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <form
            onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
            className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end"
          >
            <div>
              <Label htmlFor="p">Mobilnummer *</Label>
              <Input id="p" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="070..." />
            </div>
            <div>
              <Label htmlFor="n">Namn (valfritt)</Label>
              <Input id="n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Förnamn" />
            </div>
            <Button type="submit" disabled={createMut.isPending}>
              <Send className="h-4 w-4 mr-1" />
              {createMut.isPending ? "Skickar..." : "Skicka SMS"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" />
            <h2 className="font-semibold">Boka möte åt kund</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Skapa bokningen själv — inget SMS skickas. Du får ett färdigt meddelande att kopiera och skicka manuellt.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); manualMut.mutate(); }}
            className="grid sm:grid-cols-2 gap-3"
          >
            <div>
              <Label htmlFor="bp">Mobilnummer *</Label>
              <Input id="bp" value={bPhone} onChange={(e) => setBPhone(e.target.value)} required placeholder="070..." />
            </div>
            <div>
              <Label htmlFor="bn">Namn *</Label>
              <Input id="bn" value={bName} onChange={(e) => setBName(e.target.value)} required placeholder="Förnamn Efternamn" />
            </div>
            <div>
              <Label htmlFor="be">E-post (valfritt)</Label>
              <Input id="be" type="email" value={bEmail} onChange={(e) => setBEmail(e.target.value)} placeholder="namn@foretag.se" />
            </div>
            <div>
              <Label htmlFor="bw">Datum & tid *</Label>
              <Input id="bw" type="datetime-local" value={bWhen} onChange={(e) => setBWhen(e.target.value)} required step={300} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-2 block">Mötesform</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["zoom", "meet", "teams", "in_person"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBType(m)}
                    className={`px-3 py-2 rounded-md border text-sm transition-colors ${
                      bType === m ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                    }`}
                  >
                    {m === "zoom" ? "Zoom" : m === "meet" ? "Google Meet" : m === "teams" ? "Teams" : "Fysiskt möte"}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={manualMut.isPending} className="w-full sm:w-auto">
                <CalendarPlus className="h-4 w-4 mr-1" />
                {manualMut.isPending ? "Skapar..." : "Skapa bokning"}
              </Button>
            </div>
          </form>

          {bookMsg && (
            <div className="rounded-md border bg-muted/40 p-4 space-y-3">
              <p className="text-sm font-medium">Meddelande att skicka till kunden:</p>
              <Textarea readOnly value={bookMsg} rows={4} className="text-sm" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={copyBookMsg}>
                  <Copy className="h-4 w-4 mr-1" /> Kopiera meddelande
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => {
                  setBookMsg(null);
                  setBPhone(""); setBName(""); setBEmail(""); setBWhen("");
                }}>
                  Rensa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Länken i meddelandet visar kundens bokning med knappar för att lägga till mötet i Google, Outlook och Apple Kalender.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laddar...</p>
      ) : !data?.leads.length ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Inga kontakter än.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {data.leads.map((lead) => {
            const isOpen = openId === lead.id;
            const messages = data.messages.filter((m) => m.lead_id === lead.id);
            const booking = data.bookings.find((b) => b.lead_id === lead.id);
            const incoming = messages.filter((m) => m.direction === "in").length;
            const statusBadge =
              lead.status === "booked" ? <Badge>Bokad</Badge> :
              lead.opted_out ? <Badge variant="destructive">Avregistrerad</Badge> :
              <Badge variant="secondary">{lead.last_reminder_kind ? `Påmind (${lead.last_reminder_kind})` : "Skickad"}</Badge>;

            return (
              <Card key={lead.id}>
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : lead.id)}
                    className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/40"
                  >
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{lead.name || lead.phone}</p>
                      <p className="text-sm text-muted-foreground truncate">{lead.phone} · {fmtDate(lead.initial_sent_at || lead.created_at)}</p>
                    </div>
                    {incoming > 0 && (
                      <Badge variant="outline" className="gap-1"><MessageSquare className="h-3 w-3" /> {incoming}</Badge>
                    )}
                    {statusBadge}
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  {isOpen && (
                    <div className="border-t p-4 space-y-4">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Namn</Label>
                          <Input
                            defaultValue={lead.name ?? ""}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v !== (lead.name ?? "")) updateMut.mutate({ id: lead.id, name: v });
                            }}
                          />
                        </div>
                        <div>
                          <Label>E-post</Label>
                          <Input
                            defaultValue={lead.email ?? ""}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v !== (lead.email ?? "")) updateMut.mutate({ id: lead.id, email: v });
                            }}
                          />
                        </div>
                      </div>

                      {booking && (
                        <div className="rounded-md bg-muted/50 p-3 text-sm flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          Bokad: <strong>{fmtDate(booking.slot_start)}</strong>
                        </div>
                      )}

                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Konversation</p>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {messages.map((m) => (
                            <div
                              key={m.id}
                              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                                m.direction === "out"
                                  ? "ml-auto bg-primary text-primary-foreground"
                                  : "mr-auto bg-muted"
                              }`}
                            >
                              <p className="whitespace-pre-wrap">{m.body}</p>
                              <p className="text-[10px] opacity-70 mt-1">{fmtDate(m.created_at)}{m.reminder_kind ? ` · ${m.reminder_kind}` : ""}</p>
                            </div>
                          ))}
                          {!messages.length && <p className="text-sm text-muted-foreground">Inga meddelanden.</p>}
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t">
                        <a href={`/scandic/book/${lead.booking_token}`} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground">
                          Öppna bokningslänk
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("Ta bort denna kontakt och all historik?")) deleteMut.mutate(lead.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Ta bort
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BakomliggandeData />
      <Toaster />
    </main>
  );
}