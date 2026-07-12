import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SCANDIC_OWNER_ID, normalizePhone } from "@/lib/scandic.server";

// 46elks posts application/x-www-form-urlencoded with fields: id, from, to, message, created
export const Route = createFileRoute("/api/public/hooks/elks-incoming")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctype = request.headers.get("content-type") || "";
        let from = "";
        let message = "";
        let elksId = "";
        if (ctype.includes("application/json")) {
          const j = await request.json().catch(() => ({} as Record<string, string>));
          from = String(j.from || "");
          message = String(j.message || "");
          elksId = String(j.id || "");
        } else {
          const form = await request.formData();
          from = String(form.get("from") || "");
          message = String(form.get("message") || "");
          elksId = String(form.get("id") || "");
        }
        if (!from || !message) {
          return new Response("ok", { status: 200 });
        }
        const phone = normalizePhone(from);
        const { data: lead } = await supabaseAdmin
          .from("scandic_leads")
          .select("id")
          .eq("owner_id", SCANDIC_OWNER_ID)
          .eq("phone", phone)
          .maybeSingle();
        if (lead) {
          await supabaseAdmin.from("scandic_messages").insert({
            lead_id: lead.id,
            direction: "in",
            body: message,
            elks_id: elksId || null,
          });
          const lower = message.trim().toLowerCase();
          if (["stop", "stopp", "avregistrera", "avreg"].includes(lower)) {
            await supabaseAdmin.from("scandic_leads").update({ opted_out: true }).eq("id", lead.id);
          }
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});