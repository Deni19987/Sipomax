import { Loader2 } from "lucide-react";

/**
 * Neutral laddvy som visas medan appen avgör vart användaren hör hemma.
 *
 * Butiken och verkstaden är två helt olika skal (telefonbredd med bottenmeny
 * respektive desktop med sidomeny). Renderar vi fel skal medan kontotypen
 * hämtas blinkar det förbi innan omdirigeringen hinner ske — därför visas den
 * här i stället tills svaret finns.
 */
export function AppSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
