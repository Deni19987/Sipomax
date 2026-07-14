import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { FileText, Package } from "lucide-react";
import { ShopShell } from "@/components/shop/ShopShell";
import { formatPrice } from "@/lib/shop/catalog";
import { ORDER_STATUS_LABELS } from "@/lib/shop/orders";
import { getMyShopOrderFn } from "@/lib/shop-orders.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/bestallningar/$id")({
  ssr: false,
  component: OrderDetailPage,
});

function OrderDetailPage() {
  const { id } = Route.useParams();
  const fetchOrder = useServerFn(getMyShopOrderFn);
  const {
    data: order,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["my-shop-order", id],
    queryFn: () => fetchOrder({ data: { orderId: id } }),
    retry: false,
  });

  if (isLoading) {
    return (
      <ShopShell title="Beställning" backTo="/bestallningar">
        <div className="px-4 pt-6">
          <div className="rounded-xl bg-card p-6 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">Laddar beställning…</p>
          </div>
        </div>
      </ShopShell>
    );
  }

  if (isError || !order) {
    return (
      <ShopShell title="Beställning" backTo="/bestallningar">
        <div className="px-4 pt-6">
          <div className="rounded-xl bg-card p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-card-foreground">
              Beställningen kunde inte hittas
            </p>
            <Link
              to="/bestallningar"
              className="mt-3 inline-block text-sm font-semibold text-primary"
            >
              Till alla beställningar
            </Link>
          </div>
        </div>
      </ShopShell>
    );
  }

  const date = new Date(order.createdAt).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <ShopShell title={`Beställning #${order.orderNumber}`} backTo="/bestallningar">
      <div className="space-y-4 px-4 pt-4">
        <div className="rounded-xl bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-bold text-card-foreground">#{order.orderNumber}</p>
              <p className="text-xs text-muted-foreground">{date}</p>
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium",
                order.status === "levererad"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700",
              )}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-card p-4 shadow-sm">
          <h2 className="text-sm font-bold text-card-foreground">Produkter</h2>
          <div className="mt-3 space-y-3">
            {order.lines.map((line) => (
              <div key={line.productId} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-card-foreground">{line.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.quantity} × {formatPrice(line.unitPrice)}
                  </p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold text-card-foreground">
                  {formatPrice(line.unitPrice * line.quantity)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-base font-bold text-card-foreground">
            <span>Totalt (exkl. moms)</span>
            <span>{formatPrice(order.total)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-card p-4 shadow-sm">
          <FileText className="h-5 w-5 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            Fakturan för denna beställning skickas via Fortnox enligt ert avtal med Sipomax.
          </p>
        </div>
      </div>
    </ShopShell>
  );
}
