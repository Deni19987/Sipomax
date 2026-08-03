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
  subtitle,
  backTo,
  hideNav,
  bottomBar,
}: {
  children: ReactNode;
  /** Om satt visas en kompakt röd header med titel + tillbaka-pil. */
  title?: string;
  subtitle?: string;
  backTo?: string;
  /** Kassan döljer bottenmenyn — färre utgångar, färre avhopp. */
  hideNav?: boolean;
  /** Klibbig åtgärdsrad längst ned, t.ex. summa + "Till kassan". */
  bottomBar?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-neutral-100 shadow-xl">
        {title ? (
          <header className="sticky top-0 z-20 bg-gradient-to-b from-primary to-red-700 px-4 pb-3.5 pt-[calc(env(safe-area-inset-top)+0.85rem)] text-primary-foreground">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Tillbaka"
                onClick={() => (backTo ? navigate({ to: backTo }) : window.history.back())}
                className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors active:bg-white/20"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
                {subtitle && (
                  <p className="truncate text-xs text-primary-foreground/80">{subtitle}</p>
                )}
              </div>
            </div>
          </header>
        ) : null}

        {/* Botteninnehållet får inte skymmas: menyn ~4.5rem, åtgärdsraden ~5rem */}
        <main
          className={cn(
            "flex-1",
            bottomBar ? (hideNav ? "pb-44" : "pb-52") : hideNav ? "pb-8" : "pb-28",
          )}
        >
          {children}
        </main>

        {bottomBar && (
          <div
            className={cn(
              "fixed inset-x-0 z-30 mx-auto w-full max-w-md border-t border-border bg-card px-4 pt-3",
              hideNav
                ? "bottom-0 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
                : "bottom-[4.25rem] pb-3",
            )}
          >
            {bottomBar}
          </div>
        )}

        {!hideNav && <BottomNav />}
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

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Home }) {
  return (
    <Link
      to={to}
      className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors"
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
