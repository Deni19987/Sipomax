import { Link, createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { OrderCard } from "@/components/shop/cards";
import { ShopShell } from "@/components/shop/ShopShell";
import { useCart } from "@/lib/shop/cart";

export const Route = createFileRoute("/bestallningar/")({
  ssr: false,
  component: OrdersPage,
});

function OrdersPage() {
  const { orders } = useCart();

  return (
    <ShopShell title="Beställningar" backTo="/">
      <div className="space-y-3 px-4 pt-4">
        {orders.length > 0 ? (
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
