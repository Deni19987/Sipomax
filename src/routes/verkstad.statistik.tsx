import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPrice } from "@/lib/shop/catalog";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/shop/orders";
import { getWorkshopStatsFn } from "@/lib/shop-orders.functions";

export const Route = createFileRoute("/verkstad/statistik")({
  ssr: false,
  component: WorkshopStatsPage,
});

// En serie per diagram → en färg (magnitud = en nyans), ingen legend behövs;
// titeln namnger serien och tooltip visar exakta värden.
const BAR_COLOR = "var(--primary)";
const GRID_COLOR = "var(--border)";
const TICK_STYLE = { fontSize: 10, fill: "var(--muted-foreground)" } as const;

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("sv-SE", { month: "short" });
}

function WorkshopStatsPage() {
  const fetchStats = useServerFn(getWorkshopStatsFn);
  const { data: stats, isLoading } = useQuery({
    queryKey: ["workshop-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 60_000,
  });

  if (isLoading || !stats) {
    return (
      <div className="px-4 pt-4">
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar statistik…</p>
        </div>
      </div>
    );
  }

  const delta =
    stats.prevMonthRevenue > 0
      ? ((stats.monthRevenue - stats.prevMonthRevenue) / stats.prevMonthRevenue) * 100
      : null;
  const monthName = new Date().toLocaleDateString("sv-SE", { month: "long" });

  return (
    <div className="space-y-4 px-4 pt-4">
      <h1 className="text-lg font-bold text-foreground">Statistik</h1>

      {/* Nyckeltal för innevarande månad */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 rounded-xl bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Försäljning i {monthName}</p>
          <p className="mt-1 text-2xl font-bold text-card-foreground">
            {formatPrice(stats.monthRevenue)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {delta === null ? (
              <>
                <Minus className="h-3.5 w-3.5" /> Ingen försäljning förra månaden
              </>
            ) : delta >= 0 ? (
              <>
                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
                <span className="font-semibold text-emerald-600">+{delta.toFixed(0)} %</span>
                mot förra månaden ({formatPrice(stats.prevMonthRevenue)})
              </>
            ) : (
              <>
                <ArrowDownRight className="h-3.5 w-3.5 text-red-600" />
                <span className="font-semibold text-red-600">{delta.toFixed(0)} %</span>
                mot förra månaden ({formatPrice(stats.prevMonthRevenue)})
              </>
            )}
          </p>
        </div>
        <StatTile label="Ordrar denna månad" value={String(stats.monthOrders)} />
        <StatTile
          label="Snittorder"
          value={stats.monthOrders > 0 ? formatPrice(stats.avgOrderValue) : "–"}
        />
        <StatTile label="Aktiva kunder" value={String(stats.monthCustomers)} />
        <StatTile label="Ordrar 12 mån" value={String(stats.totalOrders)} />
      </div>

      {/* Försäljning per dag, senaste 30 dagarna */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <h2 className="text-sm font-bold text-card-foreground">
          Försäljning per dag · senaste 30 dagarna
        </h2>
        <div className="mt-3 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.dailySeries} margin={{ top: 4, right: 0, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                interval={6}
              />
              <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} width={58} />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                formatter={(value: number) => [formatPrice(value), "Försäljning"]}
                labelFormatter={(label: string) =>
                  new Date(label).toLocaleDateString("sv-SE", {
                    day: "numeric",
                    month: "long",
                  })
                }
              />
              <Bar dataKey="revenue" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Försäljning per månad, senaste 6 månaderna */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <h2 className="text-sm font-bold text-card-foreground">
          Försäljning per månad · senaste 6 månaderna
        </h2>
        <div className="mt-3 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stats.monthlySeries}
              margin={{ top: 4, right: 0, left: -18, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonth}
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
              />
              <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} width={58} />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                formatter={(value: number) => [formatPrice(value), "Försäljning"]}
                labelFormatter={(label: string) => formatMonth(label)}
              />
              <Bar dataKey="revenue" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Orderstatus just nu */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <h2 className="text-sm font-bold text-card-foreground">Orderstatus</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {ORDER_STATUSES.map((status) => (
            <div
              key={status}
              className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2"
            >
              <span className="text-xs text-muted-foreground">{ORDER_STATUS_LABELS[status]}</span>
              <span className="text-sm font-bold text-card-foreground">
                {stats.statusCounts[status]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Toppsäljare */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <h2 className="text-sm font-bold text-card-foreground">Mest sålda produkter · 12 mån</h2>
        {stats.topProducts.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Inga sålda produkter ännu.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {stats.topProducts.map((product, index) => (
              <div key={product.productId} className="flex items-center gap-3">
                <span className="w-5 text-center text-xs font-bold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-card-foreground">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.quantity} st</p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold text-card-foreground">
                  {formatPrice(product.revenue)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Största kunder */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <h2 className="text-sm font-bold text-card-foreground">Största kunder · 12 mån</h2>
        {stats.topCustomers.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Inga kunder ännu.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {stats.topCustomers.map((customer, index) => (
              <div key={customer.name} className="flex items-center gap-3">
                <span className="w-5 text-center text-xs font-bold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-card-foreground">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {customer.orders} {customer.orders === 1 ? "order" : "ordrar"}
                  </p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold text-card-foreground">
                  {formatPrice(customer.revenue)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-card-foreground">{value}</p>
    </div>
  );
}
