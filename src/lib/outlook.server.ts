// Gmail integration via Google OAuth2 + Gmail REST API.
// One shared mailbox receives all Transportstyrelsen Registerutdrag emails
// and is searched on behalf of all users.
//
// Required env vars:
//   GMAIL_CLIENT_ID      – Google OAuth2 client ID
//   GMAIL_CLIENT_SECRET  – Google OAuth2 client secret
//   GMAIL_REFRESH_TOKEN  – long-lived refresh token obtained once via OAuth consent

const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE  = "https://gmail.googleapis.com/gmail/v1/users/me";

// In-memory cache for the refresh-token path so we don't hit Google on every request
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  // Path 1: direct access token (simpler, expires in ~1 hour — update GMAIL_ACCESS_TOKEN in Netlify when it does)
  const directToken = process.env.GMAIL_ACCESS_TOKEN;
  if (directToken) return directToken;

  // Path 2: full OAuth refresh-token flow (stays valid indefinitely)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 30_000) {
    return cachedAccessToken;
  }
  const clientId     = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail är inte konfigurerat. Sätt GMAIL_ACCESS_TOKEN i Netlify-miljövariablerna " +
      "(hämta en token på https://developers.google.com/oauthplayground — välj Gmail API → readonly-scope → Sign in as deni.ferchichi@scandicreach.se).",
    );
  }
  const res = await fetch(GMAIL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail token-refresh misslyckades [${res.status}]: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = json.access_token;
  tokenExpiresAt    = Date.now() + json.expires_in * 1000;
  return cachedAccessToken;
}

async function gmailFetch(path: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${GMAIL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Returns the email address the configured token is authenticated as — i.e.
// the actual mailbox "Hämta från e-post" reads. Used for diagnostics.
export async function getMailboxAddress(): Promise<string> {
  const res = await gmailFetch("/profile");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kunde inte läsa Gmail-profil [${res.status}]: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { emailAddress?: string };
  return json.emailAddress ?? "(okänd)";
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractField(text: string, label: string, stopLabels: string[]): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stops = stopLabels
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(
    `${escaped}\\s*[\\n:]+\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stops})\\s*[\\n:]|$)`,
    "i",
  );
  const m = text.match(re);
  if (!m) return null;
  let value = m[1].replace(/\s+/g, " ").trim();
  // "Uppgift saknas." can bleed in from an adjacent field that has no label
  // of its own — strip it and anything after it.
  value = value.replace(/\s*uppgift saknas\.?\s*$/i, "").trim();
  if (!value) return null;
  return value;
}

const LABELS = [
  "Registreringsnummer",
  "Fabrikat",
  "Handelsbeteckning",
  "Fordonsslag",
  "Fordonsslagsklass",
  "Färg",
  "Fordonsstatus",
  "Antal ägare sedan fordonet togs i trafik första gången",
  "Antal ägare",
  "Ägare och brukare",
  "Ägare",
  "Adress",
  "Postnummer",
  "Postort",
  "Senast godkända besiktning",
  "Nästa besiktning senast",
  "Noterad mätarställning",
  "Personnummer",
  "Organisationsnummer",
  "Föregående ägare",
];

function parseDate(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseInt0(s: string | null): number | null {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

function parseStatus(s: string | null): string | null {
  if (!s) return null;
  return s.split("(")[0].trim() || null;
}

// Personnummer/organisationsnummer are always a fixed digit-dash pattern.
// extractField's stop-label list can't cover every field the email layout
// might place right after this one (e.g. "Föregående ägare fr.o.m"), so
// trim to just the number itself instead of trusting the whole captured
// blob — this also strips any trailing unrelated text that leaked in.
function extractNumberPattern(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/\d{2,8}-?\d{4}/);
  return m ? m[0] : null;
}

function formatCustomerName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const toTitle = (s: string) =>
    s
      .toLocaleLowerCase("sv-SE")
      .split(/(\s|-)/)
      .map((part) =>
        /\s|-/.test(part) || !part
          ? part
          : part.charAt(0).toLocaleUpperCase("sv-SE") + part.slice(1),
      )
      .join("");
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) {
    return trimmed === trimmed.toLocaleUpperCase("sv-SE") ? toTitle(trimmed) : trimmed;
  }
  const last = trimmed.slice(0, commaIdx).trim();
  const rest = trimmed.slice(commaIdx + 1).trim();
  if (!last || !rest) return trimmed;
  return toTitle(`${rest} ${last}`);
}

export interface RegisterutdragData {
  registration_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_type: string | null;
  vehicle_color: string | null;
  vehicle_status: string | null;
  owner_count: number | null;
  customer_name: string | null;
  customer_org_number: string | null;
  // True when the owner is identified by an organisationsnummer (a company)
  // rather than a personnummer (a private individual).
  customer_is_company: boolean;
  billing_address: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  last_inspection_date: string | null;
  next_inspection_date: string | null;
  mileage: number | null;
  email_received_at: string | null;
  email_subject: string | null;
}

function parseRegisterutdragText(text: string): Partial<RegisterutdragData> {
  return {
    registration_number: extractField(text, "Registreringsnummer", LABELS)?.toUpperCase() ?? null,
    vehicle_make:        extractField(text, "Fabrikat", LABELS),
    vehicle_model:       extractField(text, "Handelsbeteckning", LABELS),
    vehicle_type:        extractField(text, "Fordonsslag", LABELS),
    vehicle_color:       extractField(text, "Färg", LABELS),
    vehicle_status:      parseStatus(extractField(text, "Fordonsstatus", LABELS)),
    owner_count:
      parseInt0(extractField(text, "Antal ägare sedan fordonet togs i trafik första gången", LABELS)) ??
      parseInt0(extractField(text, "Antal ägare", LABELS)),
    customer_name: formatCustomerName(
      extractField(text, "Ägare och brukare", LABELS) ?? extractField(text, "Ägare", LABELS),
    ),
    customer_org_number: extractNumberPattern(
      extractField(text, "Personnummer", LABELS) ?? extractField(text, "Organisationsnummer", LABELS),
    ),
    customer_is_company: extractField(text, "Organisationsnummer", LABELS) != null,
    billing_address:      extractField(text, "Adress", LABELS),
    billing_postal_code:  extractField(text, "Postnummer", LABELS),
    billing_city:         extractField(text, "Postort", LABELS),
    last_inspection_date: parseDate(extractField(text, "Senast godkända besiktning", LABELS)),
    next_inspection_date: parseDate(extractField(text, "Nästa besiktning senast", LABELS)),
    mileage:              parseInt0(extractField(text, "Noterad mätarställning", LABELS)),
  };
}

// Decode Gmail message body (handles base64url parts)
function decodeGmailBody(part: any): string {
  if (!part) return "";
  // Prefer text/plain, then text/html
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    const html = Buffer.from(part.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    return htmlToText(html);
  }
  if (part.parts) {
    // Multipart: try plain first, then html
    const plain = part.parts.find((p: any) => p.mimeType === "text/plain");
    if (plain?.body?.data) {
      return Buffer.from(plain.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    }
    const html = part.parts.find((p: any) => p.mimeType === "text/html");
    if (html?.body?.data) {
      const decoded = Buffer.from(html.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
      return htmlToText(decoded);
    }
    // Recurse into nested multipart
    for (const p of part.parts) {
      const text = decodeGmailBody(p);
      if (text) return text;
    }
  }
  return "";
}

// Canonical form for reg comparison: uppercase, strip everything that isn't a
// letter/digit, and fold the letter O onto the digit 0 (and I onto 1) so the
// two visually-identical glyphs always compare equal.
function regCanonical(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
}

// Fetch + parse one message. Returns the parsed data and whether its reg matched `target`.
async function examineMessage(
  id: string,
  target: string,
  normalized: string,
): Promise<{ matched: boolean; data: RegisterutdragData } | null> {
  const msgRes = await gmailFetch(`/messages/${id}?format=full`);
  if (!msgRes.ok) return null;
  const msg = (await msgRes.json()) as { id: string; payload: any; internalDate: string; snippet: string };

  const headers = (msg.payload?.headers as Array<{ name: string; value: string }> ?? []);
  const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
  const dateHeader = headers.find((h) => h.name.toLowerCase() === "date")?.value ?? "";
  const bodyText = decodeGmailBody(msg.payload);
  const parsed = parseRegisterutdragText(bodyText);

  // Match against subject + snippet + body, all O/0-folded. The snippet is
  // always plain text (no decoding), so a failed body decode for an odd MIME
  // layout can't cause a false miss.
  const haystack = regCanonical(`${subject} ${msg.snippet ?? ""} ${bodyText}`);
  const matched = haystack.includes(target);

  return {
    matched,
    data: {
      registration_number: parsed.registration_number ?? normalized,
      vehicle_make:         parsed.vehicle_make ?? null,
      vehicle_model:        parsed.vehicle_model ?? null,
      vehicle_type:         parsed.vehicle_type ?? null,
      vehicle_color:        parsed.vehicle_color ?? null,
      vehicle_status:       parsed.vehicle_status ?? null,
      owner_count:          parsed.owner_count ?? null,
      customer_name:        parsed.customer_name ?? null,
      customer_org_number:  parsed.customer_org_number ?? null,
      customer_is_company:  parsed.customer_is_company ?? false,
      billing_address:      parsed.billing_address ?? null,
      billing_postal_code:  parsed.billing_postal_code ?? null,
      billing_city:         parsed.billing_city ?? null,
      last_inspection_date: parsed.last_inspection_date ?? null,
      next_inspection_date: parsed.next_inspection_date ?? null,
      mileage:              parsed.mileage ?? null,
      email_received_at:    dateHeader || new Date(Number(msg.internalDate)).toISOString(),
      email_subject:        subject,
    },
  };
}

async function gmailSearchIds(query: string, maxResults: number): Promise<string[]> {
  // includeSpamTrash=true so an automated "External" mail that Gmail filed in
  // Spam/Promotions/Trash is still searchable.
  const res = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}&includeSpamTrash=true`,
  );
  if (!res.ok) {
    // A failed API call (e.g. an expired GMAIL_ACCESS_TOKEN) must not look
    // like "no messages found yet" — that silently masks auth problems as
    // if the email just hadn't arrived, which is misleading and wastes time.
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail-sökningen misslyckades [${res.status}]: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  return (json.messages ?? []).map((m) => m.id);
}

export async function lookupRegisterutdragByReg(reg: string): Promise<RegisterutdragData> {
  const normalized = reg.toUpperCase().replace(/\s+/g, "").trim();
  if (!normalized) throw new Error("Registreringsnummer saknas");
  const target = regCanonical(normalized);

  // Which mailbox are we actually reading? Surfaced in errors so a wrong
  // account (token belongs to someone else than deni.ferchichi@scandicreach.se)
  // is immediately obvious.
  const mailbox = await getMailboxAddress().catch(() => "(okänd inkorg)");

  // Fetch the most recent emails from Transportstyrelsen. Searching by sender
  // is far more reliable than full-text search (which lags and misses results).
  const seen = new Set<string>();
  const candidates: string[] = [];
  const pushIds = (ids: string[]) => {
    for (const id of ids) if (!seen.has(id)) { seen.add(id); candidates.push(id); }
  };

  pushIds(await gmailSearchIds("from:fordonsuppgifter@transportstyrelsen.se", 100));

  // Finding literally zero Transportstyrelsen emails ever, out of a shared
  // mailbox that receives them continuously, means the Gmail connection
  // itself is broken (bad/expired token, revoked access, etc.) — not that
  // this particular email hasn't arrived yet.
  if (candidates.length === 0) {
    throw new Error(`Gmail-anslutningen verkar vara bruten (inkorg: ${mailbox}) — hittade inga mejl från Transportstyrelsen alls. Kontrollera Gmail-integrationen.`);
  }

  for (const id of candidates) {
    const result = await examineMessage(id, target, normalized);
    if (!result) continue;
    if (result.matched) return result.data;
  }

  // Other Transportstyrelsen emails exist, just not this reg's yet.
  throw new Error(`Mejlet har inte kommit in än för ${normalized} (inkorg: ${mailbox}). Vänta någon minut och försök igen.`);
}
