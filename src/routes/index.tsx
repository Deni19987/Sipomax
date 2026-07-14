import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CampaignBubble,
  CategoryCard,
  FreeShippingBanner,
  OrderCard,
} from "@/components/shop/cards";
import { useShopExtras } from "@/lib/shop/use-shop-extras";
import { ShopShell, SipomaxWordmark } from "@/components/shop/ShopShell";
import { useAuth } from "@/hooks/use-auth";
import { CATEGORIES } from "@/lib/shop/catalog";
import { getMyAccountInfo, listMyShopOrdersFn } from "@/lib/shop-orders.functions";

export const Route = createFileRoute("/")({
  // ssr: false så att varukorg/beställningar (localStorage) inte ger
  // hydration-mismatch, och så att auth-landningar kan fångas nedan.
  ssr: false,
  component: HomePage,
});

// Fånga URL:en vid modul-load, innan Supabases detectSessionInUrl hinner rensa
// hashen. Recovery-/invite-tokens som landar på "/" vidarebefordras till /login
// med hash + query intakta.
const _initialHash = typeof window !== "undefined" ? window.location.hash : "";
const _initialSearch = typeof window !== "undefined" ? window.location.search : "";

function isAuthLanding(): boolean {
  const hash = new URLSearchParams(_initialHash.replace(/^#/, ""));
  const type = hash.get("type");
  const hasHashTokens = !!hash.get("access_token") && (type === "recovery" || type === "invite");
  const hasCode = new URLSearchParams(_initialSearch).has("code");
  return hasHashTokens || hasCode;
}

function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");

  const fetchAccountInfo = useServerFn(getMyAccountInfo);
  const fetchOrders = useServerFn(listMyShopOrdersFn);
  const { data: accountInfo } = useQuery({
    queryKey: ["my-account-info"],
    queryFn: () => fetchAccountInfo(),
    enabled: !!user,
  });
  const { data: orders } = useQuery({
    queryKey: ["my-shop-orders"],
    queryFn: () => fetchOrders(),
    enabled: !!user,
  });

  // Verkstadskonton (inkl. utvecklarkontot) landar i verkstadsvyn — butiken
  // är kundernas vy. Utvecklaren når butiken genom att byta till ett kundkonto.
  useEffect(() => {
    if (accountInfo?.accountType === "workshop" && !isAuthLanding()) {
      navigate({ to: "/verkstad", replace: true });
    }
  }, [accountInfo, navigate]);

  // When we've just arrived from a successful login, claim the shared
  // `brand-hero` view-transition-name so the login page's red panel morphs
  // into this header. Cleared right after so ordinary navigations away from
  // the home page don't animate the header.
  const [heroMorph, setHeroMorph] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !!sessionStorage.getItem("sipomax:brandHeroMorph");
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!heroMorph) return;
    try {
      sessionStorage.removeItem("sipomax:brandHeroMorph");
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => setHeroMorph(false), 600);
    return () => clearTimeout(t);
  }, [heroMorph]);

  useEffect(() => {
    if (isAuthLanding()) {
      window.location.replace(`/login${_initialSearch}${_initialHash}`);
    }
  }, []);

  const recentOrders = (orders ?? []).slice(0, 3);
  const { getCampaign } = useShopExtras();
  const announcement = getCampaign("announcement");
  const shippingCampaign = getCampaign("free_shipping");

  return (
    <ShopShell>
      {/* Röd hjältesektion: logotyp, sök och populära kategorier */}
      <header
        className="rounded-b-3xl bg-gradient-to-b from-primary via-primary to-red-800 px-4 pb-6 pt-[calc(env(safe-area-inset-top)+1.25rem)]"
        style={heroMorph ? { viewTransitionName: "brand-hero" } : undefined}
      >
        <div className="relative flex items-center justify-center">
          <SipomaxWordmark />
          <Link
            to="/konto"
            aria-label="Konto"
            className="absolute right-0 flex h-9 w-9 items-center justify-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/15"
          >
            <UserRound className="h-6 w-6" />
          </Link>
        </div>

        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({
              to: "/produkter",
              search: { q: query || undefined, kategori: undefined },
            });
          }}
        >
          <div className="flex items-center gap-2 rounded-full bg-card px-4 py-3 shadow-md">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök produkter..."
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </form>

        <div className="mt-5 flex items-center justify-between">
          <h2 className="text-base font-bold text-primary-foreground">Populära kategorier</h2>
          <Link
            to="/produkter"
            search={{ kategori: undefined, q: undefined }}
            className="text-sm font-medium text-primary-foreground/90"
          >
            Visa alla
          </Link>
        </div>
        <div className="-mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {CATEGORIES.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        </div>
      </header>

      <div className="space-y-5 px-4 pt-5">
        {announcement ? <CampaignBubble campaign={announcement} /> : null}
        <FreeShippingBanner campaign={shippingCampaign} />

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">Tidigare beställningar</h2>
            <Link to="/bestallningar" className="text-sm font-medium text-primary">
              Visa alla
            </Link>
          </div>
          <div className="mt-3 space-y-3">
            {recentOrders.length > 0 ? (
              recentOrders.map((order) => <OrderCard key={order.id} order={order} />)
            ) : (
              <div className="rounded-xl bg-card p-6 text-center shadow-sm">
                <p className="text-sm font-semibold text-card-foreground">
                  Inga beställningar ännu
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dina lagda ordrar visas här. Börja med att utforska produkterna.
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
        </section>
      </div>
    </ShopShell>
  );
}
