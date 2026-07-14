import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { CampaignBubble, ProductCard } from "@/components/shop/cards";
import { ShopShell } from "@/components/shop/ShopShell";
import { CATEGORIES, getCategory, searchProducts } from "@/lib/shop/catalog";
import { useShopExtras } from "@/lib/shop/use-shop-extras";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  kategori: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/produkter")({
  ssr: false,
  validateSearch: searchSchema,
  component: ProductsPage,
});

function ProductsPage() {
  const { kategori, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [query, setQuery] = useState(q ?? "");

  const { customProducts, getCampaign } = useShopExtras();
  const promo = getCampaign("product_promo");

  const activeCategory = kategori ? getCategory(kategori) : undefined;
  // Verkstadens egna publicerade produkter visas överst, följda av katalogen.
  const q_ = query.trim().toLowerCase();
  const matchingCustom = customProducts.filter(
    (p) =>
      (!activeCategory || p.category === activeCategory.id) &&
      (!q_ ||
        p.name.toLowerCase().includes(q_) ||
        p.brand.toLowerCase().includes(q_) ||
        p.description.toLowerCase().includes(q_)),
  );
  const products = [
    ...matchingCustom,
    ...searchProducts(query).filter((p) => !activeCategory || p.category === activeCategory.id),
  ];

  return (
    <ShopShell title="Produkter" backTo="/">
      <div className="space-y-4 px-4 pt-4">
        <div className="flex items-center gap-2 rounded-full bg-card px-4 py-3 shadow-sm">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök produkter..."
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <CategoryChip
            label="Alla"
            active={!activeCategory}
            onClick={() => navigate({ search: (prev) => ({ ...prev, kategori: undefined }) })}
          />
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.name}
              active={activeCategory?.id === c.id}
              onClick={() => navigate({ search: (prev) => ({ ...prev, kategori: c.id }) })}
            />
          ))}
        </div>

        {activeCategory ? (
          <p className="text-xs text-muted-foreground">{activeCategory.description}</p>
        ) : null}

        {promo ? <CampaignBubble campaign={promo} /> : null}

        <div className="space-y-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
          {products.length === 0 ? (
            <div className="rounded-xl bg-card p-6 text-center shadow-sm">
              <p className="text-sm font-semibold text-card-foreground">Inga produkter hittades</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Prova ett annat sökord eller en annan kategori.
              </p>
              <Link
                to="/produkter"
                search={{ kategori: undefined, q: undefined }}
                className="mt-4 inline-block text-sm font-semibold text-primary"
                onClick={() => setQuery("")}
              >
                Rensa filter
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </ShopShell>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground shadow-sm hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
