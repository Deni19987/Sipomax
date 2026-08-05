import { createFileRoute } from "@tanstack/react-router";
import { exchangeCodeForToken, storeFortnoxTokens, verifyState } from "@/lib/fortnox.server";
import { setInvoiceProvider } from "@/lib/invoice.server";

// Var användaren ska landa efter Fortnox — butiksappen och den äldre
// verkstads-CRM:en har varsin inställningssida. Sökvägen reser signerad inuti
// state, och bara interna sökvägar accepteras, så ett manipulerat state kan
// aldrig omdirigera någon utanför appen.
const DEFAULT_RETURN_PATH = "/settings";

function safeReturnPath(state: string | null): string {
  if (!state) return DEFAULT_RETURN_PATH;
  try {
    const { returnTo } = verifyState(state);
    return returnTo && /^\/[^/\\]/.test(returnTo) ? returnTo : DEFAULT_RETURN_PATH;
  } catch {
    // Ogiltigt eller utgånget state — vi vet inte var användaren kom ifrån.
    return DEFAULT_RETURN_PATH;
  }
}

export const Route = createFileRoute("/api/public/fortnox/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const origin = url.origin;

        // Ett misslyckat försök ska landa på samma sida som ett lyckat. Annars
        // kastas den som anslöt från butiksappen ut i den gamla CRM-vyn och
        // tror att hen hamnat i ett helt annat system.
        const returnTo = safeReturnPath(state);

        if (error) {
          // Fortnox beskriver felet i error_description; den texten säger
          // betydligt mer än felkoden ensam (t.ex. vilket scope som saknas).
          const description = url.searchParams.get("error_description");
          const message = description ? `${error}: ${description}` : error;
          return Response.redirect(
            `${origin}${returnTo}?error=${encodeURIComponent(message)}`,
            302,
          );
        }
        if (!code || !state) {
          return new Response("Missing code or state", { status: 400 });
        }
        try {
          const payload = verifyState(state);
          const redirectUri = `${origin}/api/public/fortnox/callback`;
          const tokens = await exchangeCodeForToken(code, redirectUri);
          await storeFortnoxTokens(payload.userId, tokens);
          // Connecting Fortnox activates it as the user's invoice integration.
          await setInvoiceProvider(payload.userId, "fortnox");
          return Response.redirect(`${origin}${returnTo}?connected=fortnox`, 302);
        } catch (e: any) {
          return Response.redirect(
            `${origin}${returnTo}?error=${encodeURIComponent(e?.message ?? "Fortnox callback failed")}`,
            302,
          );
        }
      },
    },
  },
});
