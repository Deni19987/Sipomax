import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Home, Package, Search, ShoppingCart, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { useCart } from "@/lib/shop/cart";
import { cn } from "@/lib/utils";

/**
 * Skal för kundappen: telefonbredd, ljusgrå bakgrund och fast bottennavigering
 * med varukorgsknapp i mitten — enligt designskissen.
 */
export function ShopShell({
  children,
  title,
  backTo,
}: {
  children: ReactNode;
  /** Om satt visas en kompakt röd header med titel + tillbaka-pil. */
  title?: string;
  backTo?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-neutral-100 shadow-xl">
        {title ? (
          <header className="sticky top-0 z-20 bg-gradient-to-b from-primary to-red-700 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] text-primary-foreground">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Tillbaka"
                onClick={() =>
                  backTo ? navigate({ to: backTo }) : window.history.back()
                }
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h1 className="text-lg font-bold">{title}</h1>
            </div>
          </header>
        ) : null}
        <main className="flex-1 pb-28">{children}</main>
        <BottomNav />
        <Toaster />
      </div>
    </div>
  );
}

export function SipomaxWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-2xl font-extrabold italic tracking-[0.18em] text-primary-foreground",
        className,
      )}
    >
      SIPOMAX
    </span>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Home;
}) {
  return (
    <Link
      to={to}
      className="flex flex-1 flex-col items-center gap-1 py-2 text-muted-foreground transition-colors"
      activeProps={{ className: "text-primary" }}
      activeOptions={{ exact: to === "/" }}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-medium">{label}</span>
    </Link>
  );
}

export function BottomNav() {
  const { itemCount } = useCart();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30">
      <div className="mx-auto w-full max-w-md border-t border-border bg-card px-2 pb-[calc(env(safe-area-inset-bottom)+0.25rem)]">
        <div className="flex items-end">
          <NavItem to="/" label="Hem" icon={Home} />
          <NavItem to="/produkter" label="Produkter" icon={Search} />
          <div className="flex flex-1 justify-center">
            <Link
              to="/varukorg"
              aria-label="Varukorg"
              className="relative -mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 transition-transform active:scale-95"
            >
              <ShoppingCart className="h-6 w-6" />
              {itemCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-bold text-background">
                  {itemCount}
                </span>
              ) : null}
            </Link>
          </div>
          <NavItem to="/bestallningar" label="Beställningar" icon={Package} />
          <NavItem to="/konto" label="Konto" icon={UserRound} />
        </div>
      </div>
    </nav>
  );
}
