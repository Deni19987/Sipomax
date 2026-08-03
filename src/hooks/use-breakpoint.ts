import { useEffect, useState } from "react";

/**
 * Lyssnar på en CSS-media query. Returnerar false vid SSR/första renderingen
 * och uppdateras direkt när matchMedia finns i webbläsaren.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

// Samma brytpunkt som Tailwinds `lg`. Under den kör appen sitt mobilskal med
// bottennavigering, över den desktopskalet med sidomeny.
export const DESKTOP_QUERY = "(min-width: 1024px)";

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
