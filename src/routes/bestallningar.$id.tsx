import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileText, Package } from "lucide-react";
import { toast } from "sonner";
import { ShopShell } from "@/components/shop/ShopShell";
import { openOrDownloadPdf } from "@/lib/pdf-download";
import { formatPrice } from "@/lib/shop/catalog";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABELS, type ShopOrder } from "@/lib/shop/orders";
import { getMyOrderInvoicePdfFn } from "@/lib/shop-fortnox.functions";
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
                ORDER_STATUS_BADGE[order.status],
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

        <InvoiceSection order={order} />
      </div>
    </ShopShell>
  );
}

/**
 * Fakturan för beställningen. Den skapas i Fortnox när ordern levereras, och
 * kunden kan öppna och spara PDF:en direkt härifrån.
 */
function InvoiceSection({ order }: { order: ShopOrder }) {
  const fetchPdf = useServerFn(getMyOrderInvoicePdfFn);
  const invoice = order.invoice;

  const download = useMutation({
    mutationFn: () => fetchPdf({ data: { orderId: order.id } }),
    onSuccess: (result) =>
      openOrDownloadPdf(result.pdfBase64, `Faktura-${result.invoiceId}.pdf`).catch(() =>
        toast.error("Fakturan kunde inte öppnas."),
      ),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Fakturan kunde inte hämtas."),
  });

  if (!invoice) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-card p-4 shadow-sm">
        <FileText className="h-5 w-5 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">
          Fakturan skapas när beställningen har levererats. Då hittar du den här.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <FileText className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-card-foreground">Faktura #{invoice.invoiceId}</p>
          <p className="text-xs text-muted-foreground">
            {invoice.paidAt
              ? "Betald — tack!"
              : invoice.dueDate
                ? `Förfaller ${invoice.dueDate}`
                : "Skickad från Fortnox"}
            {invoice.total != null ? ` · ${formatPrice(invoice.total)} inkl. moms` : ""}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={download.isPending}
        onClick={() => download.mutate()}
        className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {download.isPending ? "Hämtar faktura…" : "Ladda ner faktura"}
      </button>
    </div>
  );
}
