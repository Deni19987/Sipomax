import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/customer.server";

// Temporary diagnostics endpoint for the open-invoice investigation.
// POST: receives sendBeacon batches from the phone and stores them —
// beacons survive the page reload that kills all client-side evidence.
// GET ?key=...: dumps the recent trail as JSON so it can be read without
// database access. Remove together with the client_diagnostics table.

const READ_KEY = "sipomax-diag-2026";

export const Route = createFileRoute("/api/public/client-log")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const text = await request.text();
          const body = JSON.parse(text) as {
            session?: string;
            entries?: Array<{ step?: string; detail?: string }>;
          };
          const session = String(body.session ?? "").slice(0, 40);
          const entries = (body.entries ?? []).slice(0, 25);
          const rows = entries
            .filter((e) => e && e.step)
            .map((e) => ({
              session,
              step: String(e.step).slice(0, 120),
              detail: e.detail == null ? null : String(e.detail).slice(0, 500),
            }));
          if (rows.length) {
            const { error } = await supabaseAdmin.from("client_diagnostics" as any).insert(rows);
            if (error) console.error("[client-log] insert failed", error);
          }
          return new Response(null, { status: 204 });
        } catch {
          return new Response(null, { status: 204 });
        }
      },
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("key") !== READ_KEY) {
          return new Response("Not found", { status: 404 });
        }
        const { data, error } = await supabaseAdmin
          .from("client_diagnostics" as any)
          .select("created_at, session, step, detail")
          .order("id", { ascending: false })
          .limit(120);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ entries: (data ?? []).reverse() });
      },
    },
  },
});
