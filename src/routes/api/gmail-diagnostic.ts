import { createFileRoute } from "@tanstack/react-router";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";

async function getAccessToken(): Promise<string> {
  const direct = process.env.GMAIL_ACCESS_TOKEN;
  if (direct) return direct;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Gmail env vars saknas");
  const res = await fetch(GMAIL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh misslyckades: ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export const Route = createFileRoute("/api/gmail-diagnostic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Simple secret check so this isn't publicly open
        const secret = new URL(request.url).searchParams.get("secret");
        if (secret !== "diag2025") {
          return Response.json({ error: "Behörighet saknas" }, { status: 401 });
        }

        try {
          const accessToken = await getAccessToken();

          // 1. Mailbox address
          const profileRes = await fetch(`${GMAIL_API_BASE}/profile`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const profile = profileRes.ok ? await profileRes.json() as { emailAddress?: string; messagesTotal?: number } : {};

          const SENDER = "fordonsuppgifter@transportstyrelsen.se";

          // 2. Search by sender
          const searchRes = await fetch(
            `${GMAIL_API_BASE}/messages?q=${encodeURIComponent(`from:${SENDER}`)}&maxResults=10&includeSpamTrash=true`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          const searchJson = searchRes.ok
            ? (await searchRes.json()) as { messages?: Array<{ id: string }>; resultSizeEstimate?: number }
            : { messages: [], resultSizeEstimate: 0 };

          const messageIds = (searchJson.messages ?? []).map((m) => m.id);

          // 3. Peek at the first 5 messages: subject + date + snippet
          const previews: Array<{ id: string; subject: string; date: string; snippet: string }> = [];
          for (const id of messageIds.slice(0, 5)) {
            const msgRes = await fetch(
              `${GMAIL_API_BASE}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=From`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (!msgRes.ok) continue;
            const msg = await msgRes.json() as { snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
            const headers = msg.payload?.headers ?? [];
            previews.push({
              id,
              subject: headers.find((h) => h.name === "Subject")?.value ?? "(no subject)",
              from: headers.find((h) => h.name === "From")?.value ?? "",
              date: headers.find((h) => h.name === "Date")?.value ?? "",
              snippet: (msg.snippet ?? "").slice(0, 120),
            } as any);
          }

          return Response.json({
            mailbox: profile.emailAddress ?? "(okänd)",
            total_messages_in_mailbox: profile.messagesTotal,
            sender_searched: SENDER,
            sender_search_hits_estimate: searchJson.resultSizeEstimate,
            sender_message_ids_returned: messageIds.length,
            recent_previews: previews,
          });
        } catch (err: any) {
          return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
        }
      },
    },
  },
});
