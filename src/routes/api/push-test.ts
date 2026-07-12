import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push.server";
import { isDeveloperUser } from "@/lib/profile.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/push-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return Response.json({ error: "Du behöver logga in igen" }, { status: 401 });

        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key)
          return Response.json({ error: "Servern saknar auth-konfiguration" }, { status: 500 });

        const supabase = createClient<Database>(url, key, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await supabase.auth.getClaims(token);
        const userId = data?.claims?.sub;
        if (error || !userId)
          return Response.json({ error: "Din inloggning har gått ut" }, { status: 401 });

        const isDev = await isDeveloperUser(userId);
        const broadcastAll = isDev && new URL(request.url).searchParams.get("all") === "1";

        if (broadcastAll) {
          // Send test notification to every user that has push subscriptions.
          const { data: subs } = await supabaseAdmin
            .from("push_subscriptions")
            .select("user_id");
          const uniqueUserIds = [...new Set((subs ?? []).map((s) => s.user_id))];
          const results = await Promise.all(
            uniqueUserIds.map((uid) =>
              sendPushToUser(uid, {
                title: "Sipomax",
                body: "Testnotis till alla konton – push-notiser fungerar 🎉",
                url: "/dashboard",
              }),
            ),
          );
          const totals = results.reduce(
            (acc, r) => ({
              sent: acc.sent + r.sent,
              removed: acc.removed + r.removed,
              total: acc.total + r.total,
              errors: [...acc.errors, ...r.errors],
            }),
            { sent: 0, removed: 0, total: 0, errors: [] as string[] },
          );
          return Response.json({ ...totals, accounts: uniqueUserIds.length });
        }

        const result = await sendPushToUser(userId, {
          title: "Sipomax",
          body: "Testnotis – push-notiser fungerar 🎉",
          url: "/dashboard",
        });
        return Response.json({ ...result, isDeveloper: isDev });
      },
    },
  },
});
