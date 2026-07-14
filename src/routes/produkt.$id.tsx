import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ShopShell } from "@/components/shop/ShopShell";
import { CATEGORY_ICONS } from "@/components/shop/category-icons";
import { formatPrice, getCategory } from "@/lib/shop/catalog";
import { useCart } from "@/lib/shop/cart";
import { useShopExtras } from "@/lib/shop/use-shop-extras";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/produkt/$id")({
  ssr: false,
  component: ProductPage,
});

function ProductPage() {
  const { id } = Route.useParams();
  const { findProduct } = useShopExtras();
  const product = findProduct(id);
  const { addToCart } = useCart();
  const [quantity, setQuantity] = useState(1);

  if (!product) {
    return (
      <ShopShell title="Produkt" backTo="/produkter">
        <div className="px-4 pt-6">
          <div className="rounded-xl bg-card p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-card-foreground">
              Produkten kunde inte hittas
            </p>
            <Link
              to="/produkter"
              search={{ kategori: undefined, q: undefined }}
              className="mt-3 inline-block text-sm font-semibold text-primary"
            >
              Till alla produkter
            </Link>
          </div>
        </div>
      </ShopShell>
    );
  }

  const category = getCategory(product.category);
  const Icon = CATEGORY_ICONS[product.category];

  return (
    <ShopShell title={product.brand} backTo="/produkter">
      <div className="space-y-4 px-4 pt-4">
        <div
          className={cn(
            "flex h-48 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br shadow-md",
            category?.gradient ?? "from-slate-700 to-slate-900",
          )}
        >
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <Icon className="h-16 w-16 text-white/70" />
          )}
        </div>

        <div className="rounded-xl bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {product.brand} · {category?.name}
              </p>
              <h1 className="mt-1 text-lg font-bold text-card-foreground">{product.name}</h1>
              <p className="text-sm text-muted-foreground">{product.unit}</p>
            </div>
            <p className="whitespace-nowrap text-lg font-bold text-card-foreground">
              {formatPrice(product.price)}
            </p>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {product.description}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Pris exkl. moms. Faktureras via Fortnox efter leverans.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-full bg-card shadow-sm">
            <button
              type="button"
              aria-label="Minska antal"
              onClick={() => setQuantity((n) => Math.max(1, n - 1))}
              className="flex h-11 w-11 items-center justify-center text-foreground"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-foreground">{quantity}</span>
            <button
              type="button"
              aria-label="Öka antal"
              onClick={() => setQuantity((n) => n + 1)}
              className="flex h-11 w-11 items-center justify-center text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              addToCart(product, quantity);
              toast.success(`${product.name} tillagd i varukorgen`, {
                icon: <Check className="h-4 w-4" />,
              });
            }}
            className="flex-1 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-[0.98]"
          >
            Lägg i varukorg · {formatPrice(product.price * quantity)}
          </button>
        </div>
      </div>
    </ShopShell>
  );
}
