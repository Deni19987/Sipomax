import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getInsights } from "@/lib/jobs.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Database } from "lucide-react";
import { statusLabel } from "@/lib/status";

type RawJob = { id: string; registration_number: string; customer_name: string; vehicle_make: string | null; vehicle_model: string | null; current_status: string; mileage: number | null; created_at: string; archived_at: string | null; invoice_generated_at: string | null; invoice_scheduled_at: string | null };
type RawQuote = { job_id: string; quote_amount: number; approval_state: string; created_at: string };
type RawOpp = { id: string; title: string; customer_name: string; opportunity_type: string; suggested_send_at: string; created_at: string };
type RawCamp = { id: string; title: string; campaign_type: string; recipients: unknown; suggested_send_at: string; created_at: string };
type RawData = { jobs: RawJob[]; quotes: RawQuote[]; pendingOpportunities: RawOpp[]; pendingCampaigns: RawCamp[] };

const fmtSEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n);
const fmtDate = (s: string) => new Date(s).toLocaleDateString("sv-SE");
const WEEKDAYS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

export function BakomliggandeData() {
  const fetchInsights = useServerFn(getInsights);
  const { data, isLoading } = useQuery({ queryKey: ["insights-raw"], queryFn: () => fetchInsights() });

  if (isLoading) return <p className="text-sm text-muted-foreground">Laddar bakomliggande data...</p>;
  if (!data?.rawData) return <p className="text-sm text-muted-foreground">Ingen data tillgänglig.</p>;
  return <RawDataTables raw={data.rawData as RawData} />;
}

function recipientsCount(r: unknown) { return Array.isArray(r) ? r.length : 0; }

function RawDataTables({ raw }: { raw: RawData }) {
  const totalQuoted = raw.quotes.reduce((a, q) => a + q.quote_amount, 0);
  const approvedQuoted = raw.quotes.filter((q) => q.approval_state === "approved").reduce((a, q) => a + q.quote_amount, 0);

  const activeJobs = raw.jobs.filter((j) => !j.archived_at);
  const awaitingPickup = raw.jobs.filter((j) => j.current_status === "ready_for_pickup");
  const awaitingApproval = raw.jobs.filter((j) => j.current_status === "awaiting_approval");
  const inProgressJobs = raw.jobs.filter((j) => j.current_status === "started_work" || j.current_status === "in_progress");

  const customerMap = new Map<string, { key: string; name: string; jobCount: number; regs: string[]; lastJob: string }>();
  for (const j of raw.jobs) {
    const key = (j.customer_name || "").trim().toLowerCase();
    const cur = customerMap.get(key) ?? { key, name: j.customer_name, jobCount: 0, regs: [], lastJob: j.created_at };
    cur.jobCount += 1;
    cur.regs.push(j.registration_number);
    if (j.created_at > cur.lastJob) cur.lastJob = j.created_at;
    customerMap.set(key, cur);
  }
  const customers = Array.from(customerMap.values()).sort((a, b) => b.jobCount - a.jobCount);
  const repeatCustomers = customers.filter((c) => c.jobCount > 1);

  const last7 = Date.now() - 7 * 864e5;
  const last7Jobs = raw.jobs.filter((j) => new Date(j.created_at).getTime() >= last7);

  const turnaroundRows = raw.jobs
    .filter((j) => j.archived_at)
    .map((j) => ({ ...j, days: (new Date(j.archived_at!).getTime() - new Date(j.created_at).getTime()) / 864e5 }));
  const avgDays = turnaroundRows.length ? turnaroundRows.reduce((a, r) => a + r.days, 0) / turnaroundRows.length : 0;

  const makeMap = new Map<string, number>();
  for (const j of raw.jobs) {
    const m = j.vehicle_make || "Okänt";
    makeMap.set(m, (makeMap.get(m) ?? 0) + 1);
  }
  const makes = Array.from(makeMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const wd = [0, 0, 0, 0, 0, 0, 0];
  for (const j of raw.jobs) wd[new Date(j.created_at).getDay()] += 1;

  const invoicesGenerated = raw.jobs.filter((j) => j.invoice_generated_at);
  const invoicesScheduled = raw.jobs.filter((j) => j.invoice_scheduled_at && !j.invoice_generated_at);

  const totalMileage = raw.jobs.reduce((a, j) => a + (j.mileage ?? 0), 0);
  const avgMileage = raw.jobs.length ? Math.round(totalMileage / raw.jobs.length) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" /> Bakomliggande data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataSection title="Aktiva jobb" count={activeJobs.length} summary={`Snitt mätarställning: ${avgMileage.toLocaleString("sv-SE")} km`}>
          <JobsTable jobs={activeJobs} />
        </DataSection>

        <DataSection title="Kunder" count={customers.length} summary={`${customers.reduce((a, c) => a + c.jobCount, 0)} jobb totalt`}>
          <CustomersTable rows={customers} />
        </DataSection>

        <DataSection title="Återkommande kunder" count={repeatCustomers.length} summary={`> 1 jobb`}>
          <CustomersTable rows={repeatCustomers} />
        </DataSection>

        <DataSection title="Jobb senaste 7 dagarna" count={last7Jobs.length} summary={fmtDate(new Date(last7).toISOString())}>
          <JobsTable jobs={last7Jobs} />
        </DataSection>

        <DataSection title="Genomloppstid (arkiverade)" count={turnaroundRows.length} summary={`Snitt: ${avgDays.toFixed(1)} dagar`}>
          <Table>
            <TableHeader><TableRow><TableHead>Nr</TableHead><TableHead>Kund</TableHead><TableHead>Skapad</TableHead><TableHead>Arkiverad</TableHead><TableHead className="text-right">Dagar</TableHead></TableRow></TableHeader>
            <TableBody>
              {turnaroundRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.registration_number}</TableCell>
                  <TableCell className="text-xs">{r.customer_name}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.created_at)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.archived_at!)}</TableCell>
                  <TableCell className="text-right text-xs">{r.days.toFixed(1)}</TableCell>
                </TableRow>
              ))}
              {!turnaroundRows.length && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-4">Inga arkiverade jobb</TableCell></TableRow>}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={4} className="text-right font-semibold">Snitt</TableCell><TableCell className="text-right font-semibold">{avgDays.toFixed(1)} dagar</TableCell></TableRow></TableFooter>
          </Table>
        </DataSection>

        <DataSection title="Bilmärken" count={makes.length} summary={`${raw.jobs.length} jobb`}>
          <Table>
            <TableHeader><TableRow><TableHead>Märke</TableHead><TableHead className="text-right">Antal</TableHead></TableRow></TableHeader>
            <TableBody>
              {makes.map((m) => <TableRow key={m.name}><TableCell className="text-xs">{m.name}</TableCell><TableCell className="text-right text-xs">{m.count}</TableCell></TableRow>)}
            </TableBody>
            <TableFooter><TableRow><TableCell className="font-semibold">Summa</TableCell><TableCell className="text-right font-semibold">{raw.jobs.length}</TableCell></TableRow></TableFooter>
          </Table>
        </DataSection>

        <DataSection title="Veckodagsfördelning" count={raw.jobs.length} summary="Skapade jobb per veckodag">
          <Table>
            <TableHeader><TableRow><TableHead>Dag</TableHead><TableHead className="text-right">Antal</TableHead></TableRow></TableHeader>
            <TableBody>
              {WEEKDAYS.map((d, i) => <TableRow key={d}><TableCell className="text-xs">{d}</TableCell><TableCell className="text-right text-xs">{wd[i]}</TableCell></TableRow>)}
            </TableBody>
            <TableFooter><TableRow><TableCell className="font-semibold">Summa</TableCell><TableCell className="text-right font-semibold">{raw.jobs.length}</TableCell></TableRow></TableFooter>
          </Table>
        </DataSection>

        <DataSection title="Väntar på upphämtning" count={awaitingPickup.length} summary="status: ready_for_pickup">
          <JobsTable jobs={awaitingPickup} />
        </DataSection>
        <DataSection title="Väntar på godkännande" count={awaitingApproval.length} summary="status: awaiting_approval">
          <JobsTable jobs={awaitingApproval} />
        </DataSection>
        <DataSection title="Pågående jobb" count={inProgressJobs.length} summary="status: started_work / in_progress">
          <JobsTable jobs={inProgressJobs} />
        </DataSection>

        <DataSection title="Offerter" count={raw.quotes.length} summary={`${fmtSEK(approvedQuoted)} godkänt av ${fmtSEK(totalQuoted)}`}>
          <Table>
            <TableHeader><TableRow><TableHead>Skapad</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Belopp</TableHead></TableRow></TableHeader>
            <TableBody>
              {raw.quotes.map((q, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{fmtDate(q.created_at)}</TableCell>
                  <TableCell className="text-xs">{q.approval_state}</TableCell>
                  <TableCell className="text-right text-xs">{fmtSEK(q.quote_amount)}</TableCell>
                </TableRow>
              ))}
              {!raw.quotes.length && <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-4">Inga offerter</TableCell></TableRow>}
            </TableBody>
            <TableFooter>
              <TableRow><TableCell colSpan={2} className="font-semibold">Totalt</TableCell><TableCell className="text-right font-semibold">{fmtSEK(totalQuoted)}</TableCell></TableRow>
              <TableRow><TableCell colSpan={2} className="font-semibold">Godkänt</TableCell><TableCell className="text-right font-semibold">{fmtSEK(approvedQuoted)}</TableCell></TableRow>
            </TableFooter>
          </Table>
        </DataSection>

        <DataSection title="Skapade fakturor" count={invoicesGenerated.length} summary="invoice_generated_at IS NOT NULL">
          <JobsTable jobs={invoicesGenerated} />
        </DataSection>
        <DataSection title="Schemalagda fakturor" count={invoicesScheduled.length} summary="invoice_scheduled_at IS NOT NULL">
          <JobsTable jobs={invoicesScheduled} />
        </DataSection>

        <DataSection title="Väntande uppföljningar" count={raw.pendingOpportunities.length} summary="status: pending">
          <Table>
            <TableHeader><TableRow><TableHead>Kund</TableHead><TableHead>Typ</TableHead><TableHead>Titel</TableHead><TableHead>Skicka</TableHead></TableRow></TableHeader>
            <TableBody>
              {raw.pendingOpportunities.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{o.customer_name}</TableCell>
                  <TableCell className="text-xs">{o.opportunity_type}</TableCell>
                  <TableCell className="text-xs">{o.title}</TableCell>
                  <TableCell className="text-xs">{fmtDate(o.suggested_send_at)}</TableCell>
                </TableRow>
              ))}
              {!raw.pendingOpportunities.length && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-4">Inga väntande</TableCell></TableRow>}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={4} className="text-right font-semibold">Summa: {raw.pendingOpportunities.length}</TableCell></TableRow></TableFooter>
          </Table>
        </DataSection>

        <DataSection title="Väntande kampanjer" count={raw.pendingCampaigns.length} summary={`${raw.pendingCampaigns.reduce((a, c) => a + recipientsCount(c.recipients), 0)} mottagare totalt`}>
          <Table>
            <TableHeader><TableRow><TableHead>Typ</TableHead><TableHead>Titel</TableHead><TableHead className="text-right">Mottagare</TableHead><TableHead>Skicka</TableHead></TableRow></TableHeader>
            <TableBody>
              {raw.pendingCampaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs">{c.campaign_type}</TableCell>
                  <TableCell className="text-xs">{c.title}</TableCell>
                  <TableCell className="text-right text-xs">{recipientsCount(c.recipients)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(c.suggested_send_at)}</TableCell>
                </TableRow>
              ))}
              {!raw.pendingCampaigns.length && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-4">Inga väntande</TableCell></TableRow>}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={4} className="text-right font-semibold">Summa: {raw.pendingCampaigns.length}</TableCell></TableRow></TableFooter>
          </Table>
        </DataSection>
      </CardContent>
    </Card>
  );
}

function DataSection({ title, count, summary, children }: { title: string; count: number; summary: string; children: React.ReactNode }) {
  return (
    <Collapsible className="border rounded-md">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors group">
        <div className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=closed]:-rotate-90" />
          <span className="font-medium text-sm">{title}</span>
          <Badge variant="secondary" className="text-xs">{count}</Badge>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="overflow-x-auto border-t">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function JobsTable({ jobs }: { jobs: RawJob[] }) {
  const totalMileage = jobs.reduce((a, j) => a + (j.mileage ?? 0), 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nr</TableHead>
          <TableHead>Kund</TableHead>
          <TableHead>Bil</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Skapad</TableHead>
          <TableHead className="text-right">Mätarst.</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((j) => (
          <TableRow key={j.id}>
            <TableCell className="font-mono text-xs">{j.registration_number}</TableCell>
            <TableCell className="text-xs">{j.customer_name}</TableCell>
            <TableCell className="text-xs">{[j.vehicle_make, j.vehicle_model].filter(Boolean).join(" ") || "—"}</TableCell>
            <TableCell className="text-xs">{statusLabel(j.current_status)}</TableCell>
            <TableCell className="text-xs">{fmtDate(j.created_at)}</TableCell>
            <TableCell className="text-right text-xs">{j.mileage?.toLocaleString("sv-SE") ?? "—"}</TableCell>
          </TableRow>
        ))}
        {!jobs.length && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-4">Inga jobb</TableCell></TableRow>}
      </TableBody>
      <TableFooter>
        <TableRow><TableCell colSpan={5} className="text-right font-semibold">Summa: {jobs.length}</TableCell><TableCell className="text-right font-semibold">{totalMileage.toLocaleString("sv-SE")} km</TableCell></TableRow>
      </TableFooter>
    </Table>
  );
}

function CustomersTable({ rows }: { rows: Array<{ key: string; name: string; jobCount: number; regs: string[]; lastJob: string }> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kund</TableHead>
          <TableHead className="text-right">Antal jobb</TableHead>
          <TableHead>Registrerade bilar</TableHead>
          <TableHead>Senaste jobb</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.key}>
            <TableCell className="text-xs">{c.name}</TableCell>
            <TableCell className="text-right text-xs">{c.jobCount}</TableCell>
            <TableCell className="font-mono text-xs">{Array.from(new Set(c.regs)).join(", ")}</TableCell>
            <TableCell className="text-xs">{fmtDate(c.lastJob)}</TableCell>
          </TableRow>
        ))}
        {!rows.length && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-4">Inga kunder</TableCell></TableRow>}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Summa</TableCell>
          <TableCell className="text-right font-semibold">{rows.reduce((a, c) => a + c.jobCount, 0)} jobb</TableCell>
          <TableCell colSpan={2} className="text-right font-semibold">{rows.length} kunder</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}