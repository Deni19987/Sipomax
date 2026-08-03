// Var hör den inloggade användaren hemma — butiken eller verkstaden?
//
// Butiken ("/") och verkstaden ("/verkstad") är två helt olika skal. Tidigare
// landade alla på "/", som ritade butiken och först därefter — när kontotypen
// hämtats — skickade verkstadskonton vidare. Det syntes som en blinkning av fel
// vy i fel format.
//
// Nu avgörs det i routernas beforeLoad, innan något ritas. Kontotypen läses
// direkt med webbläsarklienten (profiles har "Users can view own profile") i
// stället för via en server-funktion, så att inget behöver renderas först. Den
// sparas dessutom i localStorage: vid nästa besök vet vi svaret direkt och kan
// omdirigera utan att vänta på nätverket, samtidigt som det verifieras i
// bakgrunden.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// account_type finns ännu inte i den plattformsgenererade Database-typen
// (src/integrations/supabase/types.ts får inte redigeras), så vi går via en
// otypad klient och typar resultatet själva — samma mönster som i
// shop-orders.server.ts.
const db = supabase as unknown as SupabaseClient;

export type AccountType = "workshop" | "customer";

const CACHE_KEY = "sipomax:accountType";

export function landingPathFor(type: AccountType | null): "/" | "/verkstad" {
  return type === "workshop" ? "/verkstad" : "/";
}

export function readCachedAccountType(): AccountType | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw === "workshop" || raw === "customer" ? raw : null;
  } catch {
    return null;
  }
}

export function cacheAccountType(type: AccountType | null) {
  if (typeof window === "undefined") return;
  try {
    if (type) localStorage.setItem(CACHE_KEY, type);
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* privat läge e.d. — vi klarar oss utan cachen */
  }
}

/** Rensas vid utloggning så att nästa användare inte ärver fel landningssida. */
export function clearAccountType() {
  inflight = null;
  cacheAccountType(null);
}

// En hämtning per sidladdning räcker; beforeLoad kan köras flera gånger.
let inflight: Promise<AccountType | null> | null = null;

export function resolveAccountType(force = false): Promise<AccountType | null> {
  if (force) inflight = null;
  if (inflight) return inflight;

  inflight = (async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      cacheAccountType(null);
      return null;
    }
    const { data, error } = await db
      .from("profiles")
      .select("account_type")
      .eq("id", auth.user.id)
      .maybeSingle<{ account_type: string | null }>();
    if (error) {
      // Hellre butiken än en död sida om profilen inte går att läsa — den
      // effekt som redan finns i vyerna rättar till det när servern svarat.
      console.error("[landing] could not read account type", error.message);
      return readCachedAccountType();
    }
    const type: AccountType = data?.account_type === "customer" ? "customer" : "workshop";
    cacheAccountType(type);
    return type;
  })();

  return inflight;
}
