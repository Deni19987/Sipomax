import { createFileRoute } from "@tanstack/react-router";
import { listFortnoxWorkshopIds, syncShopOrderPayments } from "@/lib/shop-fortnox.server";

/**
 * Schemalagd avstämning: alla butiksordrar som har en Fortnox-faktura men
 * ännu inte är betalda kontrolleras mot Fortnox. Betalda fakturor flyttar
 * ordern från "levererad" till "avklarad".
 *
 * Samma nyckelkontroll som övriga hooks — endpointen ligger under /public och
 * måste därför verifiera anroparen själv.
 */
export const Route = createFileRoute("/api/public/hooks/fortnox-shop-payments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("apikey") ||
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apiKey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const workshopIds = await listFortnoxWorkshopIds();
          let checked = 0;
          let completed = 0;
          for (const workshopId of workshopIds) {
            try {
              const result = await syncShopOrderPayments(workshopId);
              checked += result.checked;
              completed += result.completed;
            } catch (e: any) {
              console.error(`[fortnox-shop-payments] workshop ${workshopId} failed`, e?.message);
            }
          }
          return Response.json({ ok: true, workshops: workshopIds.length, checked, completed });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message ?? "Failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
