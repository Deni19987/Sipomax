import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { OrderCard } from "@/components/shop/cards";
import { ShopShell } from "@/components/shop/ShopShell";
import { listMyShopOrdersFn } from "@/lib/shop-orders.functions";

export const Route = createFileRoute("/bestallningar/")({
  ssr: false,
  component: OrdersPage,
});

function OrdersPage() {
  const fetchOrders = useServerFn(listMyShopOrdersFn);
  const { data: orders, isLoading } = useQuery({
    queryKey: ["my-shop-orders"],
    queryFn: () => fetchOrders(),
  });

  return (
    <ShopShell title="Beställningar" backTo="/">
      <div className="space-y-3 px-4 pt-4">
        {isLoading ? (
          <div className="rounded-xl bg-card p-8 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">Laddar beställningar…</p>
          </div>
        ) : orders && orders.length > 0 ? (
          orders.map((order) => <OrderCard key={order.id} order={order} />)
        ) : (
          <div className="rounded-xl bg-card p-8 text-center shadow-sm">
            <Package className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold text-card-foreground">
              Inga beställningar ännu
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              När du skickar en beställning hittar du den här.
            </p>
            <Link
              to="/produkter"
              search={{ kategori: undefined, q: undefined }}
              className="mt-4 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
            >
              Utforska produkter
            </Link>
          </div>
        )}
      </div>
    </ShopShell>
  );
}
