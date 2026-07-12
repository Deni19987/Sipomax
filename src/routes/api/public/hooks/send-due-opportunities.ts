import { createFileRoute } from "@tanstack/react-router";
import { sendDueOpportunities } from "@/lib/opportunities.server";
import { sendDueCampaigns } from "@/lib/campaigns.server";

function isAuthorized(request: Request): boolean {
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!expected) return false;
  const apiKey =
    request.headers.get("apikey") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return apiKey === expected;
}

export const Route = createFileRoute("/api/public/hooks/send-due-opportunities")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const [opportunities, campaigns] = await Promise.all([sendDueOpportunities(), sendDueCampaigns()]);
          return new Response(JSON.stringify({ opportunities, campaigns }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});