import { createFileRoute } from "@tanstack/react-router";
import { exchangeCodeForToken, storeFortnoxTokens, verifyState } from "@/lib/fortnox.server";
import { setInvoiceProvider } from "@/lib/invoice.server";

export const Route = createFileRoute("/api/public/fortnox/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const origin = url.origin;

        if (error) {
          return Response.redirect(`${origin}/settings?error=${encodeURIComponent(error)}`, 302);
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
          return Response.redirect(`${origin}/settings?connected=fortnox`, 302);
        } catch (e: any) {
          return Response.redirect(
            `${origin}/settings?error=${encodeURIComponent(e?.message ?? "Fortnox callback failed")}`,
            302,
          );
        }
      },
    },
  },
});
