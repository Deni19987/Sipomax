import { Link } from "@tanstack/react-router";
import { ChevronRight, Megaphone, Package, Plus, Truck } from "lucide-react";
import { formatPrice, getCategory, type Category } from "@/lib/shop/catalog";
import { useCart } from "@/lib/shop/cart";
import {
  renderCampaignMessage,
  type ShopProduct,
  type WorkshopCampaign,
} from "@/lib/shop/campaigns";
import { ORDER_STATUS_LABELS, type ShopOrder } from "@/lib/shop/orders";
import { CATEGORY_ICONS } from "@/components/shop/category-icons";
import { cn } from "@/lib/utils";

export function CategoryCard({
  category,
  size = "md",
}: {
  category: Category;
  size?: "md" | "lg";
}) {
  const Icon = CATEGORY_ICONS[category.id];
  return (
    <Link
      to="/produkter"
      search={{ kategori: category.id, q: undefined }}
      className={cn(
        "relative flex shrink-0 flex-col justify-end overflow-hidden rounded-xl bg-gradient-to-br p-3 text-white shadow-md transition-transform active:scale-95",
        category.gradient,
        size === "md" ? "h-32 w-26" : "h-36 w-full",
      )}
    >
      <Icon className="absolute right-2 top-2 h-6 w-6 text-white/40" />
      <span className="text-sm font-semibold leading-tight drop-shadow">{category.name}</span>
    </Link>
  );
}

export function ProductCard({ product }: { product: ShopProduct }) {
  const { addToCart } = useCart();
  const category = getCategory(product.category);
  const Icon = CATEGORY_ICONS[product.category];
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-sm">
      <Link
        to="/produkt/$id"
        params={{ id: product.id }}
        className={cn(
          "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br text-white",
          category?.gradient ?? "from-slate-700 to-slate-900",
        )}
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-7 w-7 text-white/80" />
        )}
      </Link>
      <Link to="/produkt/$id" params={{ id: product.id }} className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {product.brand}
        </p>
        <p className="truncate text-sm font-semibold text-card-foreground">{product.name}</p>
        <p className="text-xs text-muted-foreground">{product.unit}</p>
        <p className="mt-0.5 text-sm font-bold text-card-foreground">
          {formatPrice(product.price)}
        </p>
      </Link>
      <button
        type="button"
        aria-label={`Lägg ${product.name} i varukorgen`}
        onClick={() => addToCart(product)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-transform active:scale-90"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}

export function OrderCard({ order }: { order: ShopOrder }) {
  const productCount = order.lines.reduce((sum, l) => sum + l.quantity, 0);
  const date = new Date(order.createdAt).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <Link
      to="/bestallningar/$id"
      params={{ id: order.id }}
      className="flex items-center gap-3 rounded-xl bg-card p-4 shadow-sm transition-colors hover:bg-accent"
    >
      <Package className="h-6 w-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-card-foreground">#{order.orderNumber}</p>
        <p className="text-xs text-muted-foreground">
          {date} · {productCount} produkter
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
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
        <span className="text-sm font-bold text-card-foreground">{formatPrice(order.total)}</span>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function FreeShippingBanner({ campaign }: { campaign?: WorkshopCampaign }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-900 p-4 text-white">
      <Truck className="h-6 w-6 shrink-0 text-primary" />
      <div>
        <p className="text-sm font-bold">
          {campaign ? renderCampaignMessage(campaign) : "Fri frakt på beställningar över 2 500 kr"}
        </p>
        <p className="text-xs text-neutral-400">Snabba leveranser · Faktura via Fortnox</p>
      </div>
    </div>
  );
}

// Frifrakt-bubblan i varukorgen. Räknar ut hur mycket som är kvar till fri
// frakt utifrån kundens nuvarande varukorg och kampanjens minimibelopp.
// Används även i verkstadens förhandsvisning.
export function CartShippingBubble({
  minOrder,
  title,
  total,
}: {
  minOrder: number;
  title?: string | null;
  total: number;
}) {
  const remaining = minOrder - total;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-900 p-4 text-white">
      <Truck className="h-6 w-6 shrink-0 text-primary" />
      <div className="min-w-0">
        {title ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">{title}</p>
        ) : null}
        <p className="text-sm">
          {remaining > 0 ? (
            <>
              Handla för <b>{formatPrice(remaining)}</b> till för fri frakt
            </>
          ) : (
            <b>Du har fri frakt på denna beställning!</b>
          )}
        </p>
      </div>
    </div>
  );
}

// Kampanjbubbla för mallarna "announcement" (startsidan) och "product_promo"
// (produktlistan). Samma komponent används i verkstadens förhandsvisning så
// att det verkstaden ser är exakt det kunden får.
export function CampaignBubble({ campaign }: { campaign: WorkshopCampaign }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Megaphone className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground">{campaign.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {renderCampaignMessage(campaign)}
        </p>
      </div>
    </div>
  );
}
