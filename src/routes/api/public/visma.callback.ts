import { createFileRoute } from "@tanstack/react-router";
import { exchangeCodeForToken, storeVismaTokens, verifyState } from "@/lib/visma.server";
import { setInvoiceProvider } from "@/lib/invoice.server";

export const Route = createFileRoute("/api/public/visma/callback")({
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
          const redirectUri = `${origin}/api/public/visma/callback`;
          const tokens = await exchangeCodeForToken(payload.env, code, redirectUri);
          await storeVismaTokens(payload.userId, payload.env, tokens);
          // Connecting Visma activates it as the user's invoice integration.
          await setInvoiceProvider(payload.userId, "visma");
          return Response.redirect(`${origin}/settings?connected=visma`, 302);
        } catch (e: any) {
          return Response.redirect(
            `${origin}/settings?error=${encodeURIComponent(e?.message ?? "Visma callback failed")}`,
            302,
          );
        }
      },
    },
  },
});