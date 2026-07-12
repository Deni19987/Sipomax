import { createFileRoute } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getInsights } from "@/lib/jobs.functions";
import { markInsightsSeen } from "@/lib/profile.functions";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wrench, Users, Repeat, Clock, TrendingUp, TrendingDown, Car, FileText,
  CheckCircle2, XCircle, AlertCircle, Receipt, KeyRound, Gauge, CalendarDays, Sparkles, Megaphone,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { statusLabel } from "@/lib/status";
import { useFeatureFlags } from "@/hooks/use-feature-flags";

export const Route = createFileRoute("/_authenticated/insights")({
  component: InsightsPage,
});

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];
const fmtSEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat("sv-SE").format(Math.round(n));
const WEEKDAYS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

function InsightsPage() {
  useScrollTopOnMount();
  const fetchInsights = useServerFn(getInsights);
  const { data, isLoading } = useQuery({ queryKey: ["insights"], queryFn: () => fetchInsights() });
  const markSeen = useServerFn(markInsightsSeen);
  const qc = useQueryClient();
  const { flags } = useFeatureFlags();
  useEffect(() => {
    markSeen().then(() => {
      qc.invalidateQueries({ queryKey: ["new-insights-count"] });
    }).catch(() => {});
  }, [markSeen, qc]);

  if (isLoading || !data) {
    return (
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Laddar insikter...</p>
      </main>
    );
  }

  const { totals, statusCounts, daily, weekday, topCustomers, topMakes, quotes, invoices, alerts } = data;
  const newCounts = data.newCounts ?? { opportunities: 0, campaigns: 0 };

  const statusData = Object.entries(statusCounts).map(([k, v]) => ({ name: statusLabel(k), value: v }));
  const weekdayData = WEEKDAYS.map((d, i) => ({ day: d, count: weekday[i] }));
  const dailyData = daily.map((d) => ({ date: d.date.slice(5), count: d.count }));

  return (
    <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Verkstadens insikter</h1>
          <p className="text-sm text-muted-foreground">Operativ översikt över jobb, kunder och fakturering</p>
        </div>
        <div className="flex gap-2">
          {flags.campaigns_enabled && (
            <Button asChild variant="outline" className="relative">
              <Link to="/campaigns">
                <Megaphone className="h-4 w-4 mr-2" /> Kampanjer
                {newCounts.campaigns > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-semibold leading-none">
                    {newCounts.campaigns}
                  </span>
                )}
              </Link>
            </Button>
          )}
          {flags.opportunities_enabled && (
            <Button asChild className="relative">
              <Link to="/opportunities">
                <Sparkles className="h-4 w-4 mr-2" /> Uppföljningar
                {newCounts.opportunities > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-semibold leading-none">
                    {newCounts.opportunities}
                  </span>
                )}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Operational alerts */}
      <div className="grid gap-3 sm:grid-cols-3">
        <AlertCard
          icon={<KeyRound className="h-5 w-5" />}
          tone="emerald"
          label="Redo för upphämtning"
          value={alerts.awaitingPickup}
          hint="Bilar klara att hämtas av kund"
        />
        <AlertCard
          icon={<AlertCircle className="h-5 w-5" />}
          tone="amber"
          label="Inväntar offertsvar"
          value={alerts.awaitingApproval}
          hint="Kunder behöver godkänna offert"
        />
        <AlertCard
          icon={<Wrench className="h-5 w-5" />}
          tone="blue"
          label="Aktivt arbete pågår"
          value={alerts.inProgress}
          hint="Jobb där verkstaden jobbar nu"
        />
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Wrench className="h-4 w-4" />} label="Aktiva jobb" value={fmtNum(totals.active)} sub={`${fmtNum(totals.total)} totalt`} />
        <Kpi icon={<Users className="h-4 w-4" />} label="Kunder" value={fmtNum(totals.totalCustomers)} sub={`${fmtNum(totals.repeatCustomers)} återkommande`} />
        <Kpi
          icon={<Repeat className="h-4 w-4" />}
          label="Återkommande kunder"
          value={`${totals.repeatRate.toFixed(0)}%`}
          sub="Andel med fler än ett jobb"
        />
        <Kpi
          icon={<Clock className="h-4 w-4" />}
          label="Snitt-tid per jobb"
          value={`${totals.avgTurnaround.toFixed(1)} d`}
          sub="Från inlämning till avklarat"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={totals.weekDelta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Jobb senaste 7 dagar"
          value={fmtNum(totals.last7)}
          sub={`${totals.weekDelta >= 0 ? "+" : ""}${totals.weekDelta.toFixed(0)}% mot föregående vecka`}
        />
        <Kpi icon={<Gauge className="h-4 w-4" />} label="Genomsnittlig mätarställning" value={`${fmtNum(totals.avgMileage)} km`} sub="Över alla jobb" />
        <Kpi icon={<Receipt className="h-4 w-4" />} label="Fakturerat" value={fmtNum(invoices.generated)} sub={`${fmtNum(invoices.scheduled)} schemalagda`} />
        <Kpi
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Godkänt offertvärde"
          value={fmtSEK(quotes.approvedValue)}
          sub={`av ${fmtSEK(quotes.totalQuoted)} offererat`}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Inkomna jobb — senaste 30 dagar
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status — aktiva jobb</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {statusData.length === 0 ? (
              <Empty text="Inga aktiva jobb" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {statusData.map((s, i) => (
                <Badge key={s.name} variant="outline" className="text-xs">
                  <span
                    className="inline-block h-2 w-2 rounded-full mr-1.5"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  {s.name} · {s.value}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4" /> Mest betjänade bilmärken
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {topMakes.length === 0 ? (
              <Empty text="Inga märken registrerade än" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topMakes} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Inkomna jobb per veckodag
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdayData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Quotes & top customers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Offerter
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <MiniStat icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Godkända" value={quotes.approved} />
              <MiniStat icon={<AlertCircle className="h-4 w-4 text-amber-600" />} label="Väntar svar" value={quotes.pending} />
              <MiniStat icon={<XCircle className="h-4 w-4 text-red-600" />} label="Avvisade" value={quotes.rejected} />
            </div>
            <div className="pt-2 border-t space-y-1.5 text-sm">
              <Row label="Godkännandegrad" value={`${quotes.approvalRate.toFixed(0)}%`} />
              <Row label="Snittstorlek på offert" value={fmtSEK(quotes.avgQuote)} />
              <Row label="Totalt offererat värde" value={fmtSEK(quotes.totalQuoted)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Toppkunder
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCustomers.length === 0 ? (
              <Empty text="Inga kunder än" />
            ) : (
              <ol className="space-y-2">
                {topCustomers.map((c, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-sm">{c.name}</span>
                    <Badge variant="secondary">{c.count} jobb</Badge>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Fakturering
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 text-center">
          <MiniStat icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Skapade fakturor" value={invoices.generated} />
          <MiniStat icon={<Clock className="h-4 w-4 text-blue-600" />} label="Schemalagda" value={invoices.scheduled} />
          <MiniStat icon={<XCircle className="h-4 w-4 text-red-600" />} label="Fel vid fakturering" value={invoices.errors} />
        </CardContent>
      </Card>

    </main>
  );
}




function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
          <span>{label}</span>
          <span>{icon}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function AlertCard({
  icon, label, value, hint, tone,
}: { icon: React.ReactNode; label: string; value: number; hint: string; tone: "emerald" | "amber" | "blue" }) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  }[tone];
  return (
    <Card className={`border ${toneClass}`}>
      <CardContent className="py-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-background/70 flex items-center justify-center">{icon}</div>
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-none">{value}</div>
          <div className="text-sm font-medium mt-1">{label}</div>
          <div className="text-xs opacity-80">{hint}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-center mb-1">{icon}</div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{text}</div>;
}

