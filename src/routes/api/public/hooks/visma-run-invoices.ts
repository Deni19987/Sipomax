import { createFileRoute } from "@tanstack/react-router";
import { runDueInvoices } from "@/lib/invoice.server";

export const Route = createFileRoute("/api/public/hooks/visma-run-invoices")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apiKey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        try {
          // Visma (push) generates due invoices on schedule. Fortnox invoices are
          // created from the app on demand (preview / bokför / skicka), so there is
          // no scheduled Fortnox work here.
          const visma = await runDueInvoices();
          return Response.json({ ok: true, visma });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message ?? "Failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
      },
    },
  },
});