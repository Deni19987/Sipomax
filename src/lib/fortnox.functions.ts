import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAuthorizeUrl,
  disconnectFortnox,
  getFortnoxConnection,
  signState,
} from "./fortnox.server";
import { setInvoiceProvider } from "./invoice.server";
import { getWorkshopId } from "./profile.server";

export const getFortnoxStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workshopId = await getWorkshopId(context.userId);
    const conn = await getFortnoxConnection(workshopId);
    if (!conn) return { connected: false as const };
    return {
      connected: true as const,
      updated_at: conn.updated_at,
      expires_at: conn.expires_at,
    };
  });

export const getFortnoxAuthorizeUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ context }) => {
    // Sign the workshop ID so the connection is shared across all logins.
    const workshopId = await getWorkshopId(context.userId);
    const state = signState({ userId: workshopId, ts: Date.now() });
    // Fortnox requires an exact match against the registered redirect URI, so
    // always use the published canonical URL regardless of the click origin.
    const canonicalOrigin =
      process.env.CANONICAL_APP_URL?.replace(/\/$/, "") ||
      "https://sipomax.se";
    const redirectUri = `${canonicalOrigin}/api/public/fortnox/callback`;
    return { url: buildAuthorizeUrl(state, redirectUri) };
  });

export const disconnectFortnoxFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workshopId = await getWorkshopId(context.userId);
    await disconnectFortnox(workshopId);
    // If Fortnox was the active provider, fall back to Visma so the job UI
    // doesn't keep pointing at a disconnected integration.
    await setInvoiceProvider(workshopId, "visma");
    return { ok: true };
  });
