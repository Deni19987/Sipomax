import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MessageSquare, Package, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "@/lib/shop/catalog";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type ShopOrder,
  type ShopOrderStatus,
} from "@/lib/shop/orders";
import { listWorkshopOrdersFn, updateShopOrderStatusFn } from "@/lib/shop-orders.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/verkstad/")({
  ssr: false,
  component: WorkshopOrdersPage,
});

const STATUS_BADGE: Record<ShopOrderStatus, string> = {
  mottagen: "bg-amber-100 text-amber-700",
  behandlas: "bg-sky-100 text-sky-700",
  skickad: "bg-violet-100 text-violet-700",
  levererad: "bg-emerald-100 text-emerald-700",
};

function WorkshopOrdersPage() {
  const fetchOrders = useServerFn(listWorkshopOrdersFn);
  const { data: orders, isLoading } = useQuery({
    queryKey: ["workshop-orders"],
    queryFn: () => fetchOrders(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-3 px-4 pt-4">
      <h1 className="text-lg font-bold text-foreground">Inkomna beställningar</h1>
      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar beställningar…</p>
        </div>
      ) : orders && orders.length > 0 ? (
        orders.map((order) => <WorkshopOrderCard key={order.id} order={order} />)
      ) : (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <Package className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-card-foreground">Inga beställningar ännu</p>
          <p className="mt-1 text-xs text-muted-foreground">
            När kunder skickar beställningar i butiken dyker de upp här.
          </p>
        </div>
      )}
    </div>
  );
}

function WorkshopOrderCard({ order }: { order: ShopOrder }) {
  const queryClient = useQueryClient();
  const updateStatus = useServerFn(updateShopOrderStatusFn);
  const mutation = useMutation({
    mutationFn: (status: ShopOrderStatus) => updateStatus({ data: { orderId: order.id, status } }),
    onSuccess: (_, status) => {
      toast.success(`Order #${order.orderNumber} → ${ORDER_STATUS_LABELS[status]}`);
      queryClient.invalidateQueries({ queryKey: ["workshop-orders"] });
      queryClient.invalidateQueries({ queryKey: ["workshop-stats"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Statusen kunde inte uppdateras."),
  });

  const date = new Date(order.createdAt).toLocaleString("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Package className="h-6 w-6 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-card-foreground">#{order.orderNumber}</p>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-medium",
            STATUS_BADGE[order.status],
          )}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      <div className="mt-3 rounded-lg bg-muted/50 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
          <UserRound className="h-4 w-4 shrink-0 text-primary" />
          {order.customerName || "Okänd kund"}
        </p>
        <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
          {order.customerEmail && (
            <a
              href={`mailto:${order.customerEmail}`}
              className="flex items-center gap-2 hover:text-foreground"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" /> {order.customerEmail}
            </a>
          )}
          {order.customerPhone && (
            <a
              href={`tel:${order.customerPhone}`}
              className="flex items-center gap-2 hover:text-foreground"
            >
              <Phone className="h-3.5 w-3.5 shrink-0" /> {order.customerPhone}
            </a>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {order.lines.map((line) => (
          <div key={line.productId} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-card-foreground">{line.name}</p>
              <p className="text-xs text-muted-foreground">
                {line.quantity} × {formatPrice(line.unitPrice)}
                {line.unit ? ` · ${line.unit}` : ""}
              </p>
            </div>
            <p className="whitespace-nowrap text-sm font-semibold text-card-foreground">
              {formatPrice(line.unitPrice * line.quantity)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-bold text-card-foreground">
          Totalt {formatPrice(order.total)}
        </span>
        <div className="flex items-center gap-2">
          <Link
            to="/verkstad/chatt"
            search={{ trad: order.id }}
            aria-label={`Chatta om order #${order.orderNumber}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent"
          >
            <MessageSquare className="h-4 w-4" />
          </Link>
          <Select
            value={order.status}
            onValueChange={(status) => mutation.mutate(status as ShopOrderStatus)}
            disabled={mutation.isPending}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_STATUSES.map((status) => (
                <SelectItem key={status} value={status} className="text-xs">
                  {ORDER_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
