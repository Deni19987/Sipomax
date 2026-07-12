import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { debugFortnoxPaymentTermsRaw } from "@/lib/fortnox.server";
import { getWorkshopId } from "@/lib/profile.server";

// Temporary diagnostic: shows the raw Fortnox /termsofpayments response for
// the logged-in workshop, so a missing-scope 403 can be told apart from a
// 200 with a body shape our parsing doesn't expect. Visit while logged in —
// auth is via the normal session cookie, no separate secret.
export const Route = createFileRoute("/api/fortnox-payment-terms-diagnostic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const cookie = request.headers.get("cookie") ?? "";
          const url = process.env.SUPABASE_URL;
          const key = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!url || !key) return Response.json({ error: "Supabase env vars saknas" }, { status: 500 });

          const supabase = createClient(url, key, {
            global: { headers: { cookie } },
          });
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return Response.json({ error: "Inte inloggad" }, { status: 401 });

          const workshopId = await getWorkshopId(user.id);
          const result = await debugFortnoxPaymentTermsRaw(workshopId);
          return Response.json(result);
        } catch (err: any) {
          return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
        }
      },
    },
  },
});
