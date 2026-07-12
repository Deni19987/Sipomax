import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { deleteFortnoxArticle } from "@/lib/fortnox.server";
import { getWorkshopId } from "@/lib/profile.server";

export const Route = createFileRoute("/api/fortnox-article-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const cookie = request.headers.get("cookie") ?? "";
          const url = process.env.SUPABASE_URL;
          const key = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!url || !key) return new Response(null, { status: 204 });

          const supabase = createClient(url, key, {
            global: { headers: { cookie } },
          });
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return new Response(null, { status: 204 });

          const { articleNumber } = await request.json();
          if (!articleNumber || typeof articleNumber !== "string") return new Response(null, { status: 204 });

          const workshopId = await getWorkshopId(user.id);
          await deleteFortnoxArticle(workshopId, articleNumber.trim());
        } catch {
          // Best-effort cleanup — never return an error to the client
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
