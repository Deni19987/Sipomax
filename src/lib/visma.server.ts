import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPickupThanksSms } from "./jobs.server";

export type VismaEnv = "sandbox" | "production";

export const VISMA_URLS = {
  sandbox: {
    identity: "https://identity-sandbox.test.vismaonline.com",
    api: "https://eaccountingapi-sandbox.test.vismaonline.com",
  },
  production: {
    identity: "https://identity.vismaonline.com",
    api: "https://eaccountingapi.vismaonline.com",
  },
} as const;

export const VISMA_SCOPES = "ea:accounting ea:sales offline_access";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function stateSecret(): string {
  // Use service role key as HMAC secret (never exposed to client)
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signState(payload: { userId: string; env: VismaEnv; ts: number }): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(token: string): { userId: string; env: VismaEnv; ts: number } {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Invalid state");
  const expected = b64url(createHmac("sha256", stateSecret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid state signature");
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  if (Date.now() - payload.ts > 15 * 60 * 1000) throw new Error("State expired");
  return payload;
}

export function buildAuthorizeUrl(env: VismaEnv, state: string, redirectUri: string): string {
  const clientId = requireEnv("VISMA_CLIENT_ID");
  const url = new URL(`${VISMA_URLS[env].identity}/connect/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", VISMA_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(env: VismaEnv, body: URLSearchParams) {
  const clientId = requireEnv("VISMA_CLIENT_ID");
  const clientSecret = requireEnv("VISMA_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${VISMA_URLS[env].identity}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Visma token error [${res.status}]: ${text.slice(0, 300)}`);
  return JSON.parse(text) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
}

export async function exchangeCodeForToken(env: VismaEnv, code: string, redirectUri: string) {
  return tokenRequest(env, new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }));
}

export async function refreshAccessToken(env: VismaEnv, refreshToken: string) {
  return tokenRequest(env, new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export async function storeVismaTokens(userId: string, env: VismaEnv, tokens: { access_token: string; refresh_token: string; expires_in: number }) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from("visma_connections")
    .upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      environment: env,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function getVismaConnection(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("visma_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getValidAccessToken(userId: string): Promise<{ token: string; env: VismaEnv }> {
  const conn = await getVismaConnection(userId);
  if (!conn) throw new Error("Visma is not connected for this user");
  const env = conn.environment as VismaEnv;
  if (new Date(conn.expires_at).getTime() > Date.now() + 30_000) {
    return { token: conn.access_token, env };
  }
  const refreshed = await refreshAccessToken(env, conn.refresh_token);
  await storeVismaTokens(userId, env, refreshed);
  return { token: refreshed.access_token, env };
}

async function vismaFetch(userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  let { token, env } = await getValidAccessToken(userId);
  const doFetch = (t: string) => fetch(`${VISMA_URLS[env].api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  let res = await doFetch(token);
  if (res.status === 401) {
    const conn = await getVismaConnection(userId);
    if (!conn) throw new Error("Visma connection lost");
    const refreshed = await refreshAccessToken(env, conn.refresh_token);
    await storeVismaTokens(userId, env, refreshed);
    res = await doFetch(refreshed.access_token);
  }
  return res;
}

async function vismaJson<T = any>(userId: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await vismaFetch(userId, path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`Visma API ${path} [${res.status}]: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// AI summarizer (re-used here so this module is self-contained server-side)
export async function aiRewrite(systemPrompt: string, userText: string): Promise<string> {
  try {
    const { callGemini } = await import("./ai-client.server");
    return await callGemini(systemPrompt, userText);
  } catch {
    return userText.slice(0, 500);
  }
}

const QUOTE_LINE_PROMPT = `Du skriver texten till EN fakturarad på en bilverkstadsfaktura, på svenska.
Raden ska vara en KORT, KONCIS LISTA över de tjänster/åtgärder som ingick i denna offert – inget mer.

FORMAT:
- Lista tjänsterna separerade med kommatecken på en rad, t.ex. "Byte bromsbelägg fram, bromsskivor fram, bromsvätska".
- Inga priser, ingen mängd, inga datum, ingen inledande fras ("Vi har..."), ingen artighetsfras.
- Max 160 tecken totalt.

STRIKTA REGLER:
- Använd ENDAST information som finns ordagrant i texten du får.
- Hitta INTE på delar, märken, mått, tider eller diagnoser som inte nämns.
- Om underlaget bara nämner en åtgärd: skriv bara den.
- Om underlaget är tomt: returnera "Utfört arbete enligt godkänd offert".`;
const SUMMARY_PROMPT = `Du skriver en kort, personlig sammanfattning av besöket hos bilverkstaden, på svenska, som visas som en informationsrad längst ned på fakturan.
Tonen ska vara personlig och varm men professionell – som ett kort tackmeddelande från verkstaden till kunden om vad som hände vid besöket. Max 400 tecken.

RIKTLINJER:
- Skriv som en sammanhängande kort text (1–3 meningar), inte punktlista.
- Sammanfatta jobbet som helhet – inte enskilda åtgärder från offerter (de står redan som egna rader ovanför).
- Du får tacka kunden för besöket och kort nämna huvuddraget i det som gjordes.
- Inga priser. Ingen upprepning av offertraderna.

STRIKTA REGLER — ANTI-HALLUCINATION:
- Använd ENDAST fakta som ordagrant förekommer i underlaget (statusuppdateringar och chatt).
- Hitta INTE på reservdelar, märken, mått, diagnoser eller orsaker som inte uttryckligen står där.
- Om underlaget är tomt eller saknar konkret innehåll: returnera en kort, generell tackfras typ "Tack för att du valde oss för servicen av din bil!".`;

export { QUOTE_LINE_PROMPT, SUMMARY_PROMPT };

export async function loadJobBillable(jobId: string, workshopId?: string) {
  let q = supabaseAdmin.from("jobs").select("*").eq("id", jobId);
  if (workshopId) q = q.eq("workshop_id", workshopId);
  const { data: job, error: jobErr } = await q.single();
  if (jobErr) throw new Error(jobErr.message);
  if (!job) throw new Error("Job not found");

  const { data: updates, error: updErr } = await supabaseAdmin
    .from("status_updates")
    .select("*, status_update_attachments(file_name, mime_type)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (updErr) throw new Error(updErr.message);

  const approvedQuotes = (updates ?? []).filter((u: any) =>
    u.status === "quote_sent" && u.approval_state === "approved" && u.quote_amount != null
  );
  const directApproved = (updates ?? []).filter((u: any) =>
    u.status === "quote_approved" && u.quote_amount != null
  );
  const billable = [...approvedQuotes, ...directApproved];
  const nonBillable = (updates ?? []).filter((u: any) => !billable.includes(u));

  const { data: messages, error: msgErr } = await supabaseAdmin
    .from("messages")
    .select("sender_type, body, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (msgErr) throw new Error(msgErr.message);

  return { job, billable, nonBillable, messages: messages ?? [] };
}

export function buildSummaryContext(nonBillable: any[], messages: Array<{ sender_type: string; body: string }>): string {
  const updatesBlock = nonBillable.length
    ? nonBillable
        .map((u: any) => {
          const attachments = (u.status_update_attachments ?? [])
            .map((a: any) => a.file_name)
            .filter(Boolean);
          const attachLine = attachments.length ? `\n  Bilagor: ${attachments.join(", ")}` : "";
          return `- [${u.status}] ${u.description ?? ""}${attachLine}`;
        })
        .join("\n")
    : "(inga statusuppdateringar utan offert)";

  const chatBlock = messages.length
    ? messages
        .map((m) => `- ${m.sender_type === "workshop" ? "Mekaniker" : "Kund"}: ${m.body}`)
        .join("\n")
    : "(inga chattmeddelanden)";

  return `STATUSUPPDATERINGAR (inklusive filnamn på uppladdade bilder):\n${updatesBlock}\n\nCHATT MELLAN MEKANIKER OCH KUND:\n${chatBlock}`;
}

export async function previewInvoiceTextForJob(jobId: string): Promise<{ lines: Array<{ description: string; amount: number }>; summary: string }> {
  const { billable, nonBillable, messages } = await loadJobBillable(jobId);
  const lineTexts = await Promise.all(
    billable.map(async (u: any) => aiRewrite(QUOTE_LINE_PROMPT, u.description || "Godkänd offert"))
  );
  const hasContent = nonBillable.length > 0 || messages.length > 0;
  const summary = hasContent
    ? await aiRewrite(SUMMARY_PROMPT, buildSummaryContext(nonBillable, messages))
    : "";
  return {
    lines: billable.map((u: any, i: number) => ({
      description: lineTexts[i] || u.description || "Utfört arbete",
      amount: Number(u.quote_amount),
    })),
    summary,
  };
}

export type InvoiceOverrides = {
  invoice_date?: string;
  due_date?: string;
  delivery_date?: string;
  our_reference?: string;
  your_reference?: string;
  your_order_reference?: string;
  is_credit_invoice?: boolean;
  line_texts?: string[];
  line_amounts?: number[];
  summary_text?: string | null;
};

async function findOrCreateCustomer(userId: string, job: any): Promise<string> {
  // Try search by corporate identity number first, then email
  const name = (job.customer_name || "Customer").trim();
  const email = (job.customer_email || "").trim();
  const orgNumber = (job.customer_org_number || "").trim();

  if (orgNumber) {
    const r = await vismaJson<{ Data?: Array<{ Id: string }> }>(
      userId,
      `/v2/customers?$filter=${encodeURIComponent(`CorporateIdentityNumber eq '${orgNumber.replace(/'/g, "''")}'`)}`
    );
    if (r.Data?.[0]?.Id) return r.Data[0].Id;
  }
  if (email) {
    const r = await vismaJson<{ Data?: Array<{ Id: string }> }>(
      userId,
      `/v2/customers?$filter=${encodeURIComponent(`EmailAddress eq '${email.replace(/'/g, "''")}'`)}`
    );
    if (r.Data?.[0]?.Id) return r.Data[0].Id;
  }

  // Create
  const body: Record<string, any> = {
    Name: name,
    IsPrivatePerson: !orgNumber,
    CountryCode: "SE",
    CurrencyCode: "SEK",
  };
  // Visma kräver TermsOfPaymentId — hämta första tillgängliga från företaget.
  try {
    const terms = await vismaJson<{ Data?: Array<{ Id: string; AvailableForSales?: boolean }> }>(
      userId,
      "/v2/termsofpayments"
    );
    const pick = terms.Data?.find((t) => t.AvailableForSales !== false) ?? terms.Data?.[0];
    if (pick?.Id) body.TermsOfPaymentId = pick.Id;
  } catch {
    // Om hämtningen misslyckas låter vi Visma returnera felet nedan.
  }
  if (orgNumber) body.CorporateIdentityNumber = orgNumber;
  if (email) body.EmailAddress = email;
  if (job.customer_phone) body.MobilePhone = job.customer_phone;
  if (job.billing_address) body.InvoiceAddress1 = job.billing_address;
  // Visma kräver alltid InvoicePostalCode och InvoiceCity vid skapande av kund.
  body.InvoicePostalCode = (job.billing_postal_code || "00000").toString();
  body.InvoiceCity = (job.billing_city || "Okänd").toString();

  const created = await vismaJson<{ Id: string }>(userId, "/v2/customers", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!created.Id) throw new Error("Visma did not return a customer id");
  return created.Id;
}

async function buildVismaInvoiceBodyForJob(userId: string, jobId: string, overrides: InvoiceOverrides = {}) {
  const { job, billable, nonBillable, messages } = await loadJobBillable(jobId, userId);
  const lineTexts: string[] = overrides.line_texts && overrides.line_texts.length === billable.length
    ? overrides.line_texts
    : await Promise.all(
        billable.map(async (u: any) => aiRewrite(QUOTE_LINE_PROMPT, u.description || "Godkänd offert"))
      );

  const workSummary = overrides.summary_text !== undefined
    ? (overrides.summary_text || "").trim()
    : ((nonBillable.length || messages.length)
        ? await aiRewrite(SUMMARY_PROMPT, buildSummaryContext(nonBillable, messages))
        : "");

  // Get/create customer
  const customerId = await findOrCreateCustomer(userId, job);

  // Visma kräver ArticleId på alla icke-textrader. Hämta första tillgängliga artikel.
  const articles = await vismaJson<{ Data?: Array<{ Id: string; IsActive?: boolean }> }>(
    userId,
    "/v2/articles?$top=1"
  );
  const defaultArticleId = articles.Data?.[0]?.Id;
  if (!defaultArticleId) {
    throw new Error("Inga artiklar finns i Visma. Skapa minst en artikel i Visma och försök igen.");
  }

  // Build invoice draft rows
  // CustomerInvoiceDraftRow shape (eAccounting v2):
  //   { LineNumber, ArticleId?, IsTextRow, Text?, UnitPrice?, Quantity?, ReversedConstructionServicesVatFree, ... }
  const rows: any[] = [];
  let lineNumber = 1;

  // Header text row with vehicle reference
  const vehicle = [job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ");
  rows.push({
    LineNumber: lineNumber++,
    IsTextRow: true,
    Text: `${(job as any).identifier_type === "article" ? "Art.nr" : "Reg.nr"}: ${job.registration_number}${vehicle ? ` — ${vehicle}` : ""}`,
    ReversedConstructionServicesVatFree: false,
  });

  // Billable lines
  billable.forEach((u: any, i: number) => {
    const amount =
      overrides.line_amounts && overrides.line_amounts[i] != null
        ? Number(overrides.line_amounts[i])
        : Number(u.quote_amount);
    rows.push({
      LineNumber: lineNumber++,
      IsTextRow: false,
      ArticleId: defaultArticleId,
      Text: lineTexts[i] || u.description || "Utfört arbete",
      UnitPrice: amount,
      Quantity: 1,
      ReversedConstructionServicesVatFree: false,
    });
  });

  // Informational summary row (no charge)
  if (workSummary) {
    rows.push({
      LineNumber: lineNumber++,
      IsTextRow: true,
      Text: `Utfört arbete:\n${workSummary}`,
      ReversedConstructionServicesVatFree: false,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const invoiceBody: Record<string, any> = {
    CustomerId: customerId,
    InvoiceDate: overrides.invoice_date || today,
    Currency: "SEK",
    EuThirdParty: false,
    RotReducedInvoicingType: 0,
    Rows: rows,
    YourReference: overrides.your_reference || job.customer_name,
    OurReference: overrides.our_reference || job.registration_number || "",
  };
  if (overrides.due_date) invoiceBody.DueDate = overrides.due_date;
  if (overrides.delivery_date) invoiceBody.DeliveryDate = overrides.delivery_date;
  if (overrides.your_order_reference) invoiceBody.YourOrderNumber = overrides.your_order_reference;
  if (overrides.is_credit_invoice) invoiceBody.IsCreditInvoice = true;

  return { job, invoiceBody };
}

export async function generateVismaInvoiceForJob(
  userId: string,
  jobId: string,
  overrides: InvoiceOverrides = {},
): Promise<{ invoiceId: string }> {
  const { invoiceId } = await ensureVismaInvoiceDraftForJob(userId, jobId, overrides);
  return { invoiceId };
}

export async function fetchVismaInvoiceDraftPdf(userId: string, draftId: string): Promise<string> {
  const draft = await getVismaInvoiceDraft(userId, draftId);
  if (!draft) throw new Error("Fakturautkastet hittades inte i Spiris.");
  return previewVismaInvoicePdf(userId, invoicePreviewBodyFromDraft(draft));
}

async function getVismaInvoiceDraft(userId: string, draftId: string): Promise<any | null> {
  const id = encodeURIComponent(draftId);
  const path = `/v2/customerinvoicedrafts/${id}`;
  const res = await vismaFetch(userId, path, { method: "GET" });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Kunde inte hämta fakturautkast från Spiris: GET ${path} [${res.status}]: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function draftBelongsToJob(draft: any, job: any): boolean {
  const jobRef = `Job ${String(job.id).slice(0, 8)}`;
  const ourReference = String(draft?.OurReference ?? "").trim();
  if (ourReference === jobRef || ourReference.includes(String(job.id).slice(0, 8))) return true;

  const registration = String(job.registration_number ?? "").trim().toLowerCase();
  const rows = draft?.Rows ?? draft?.CustomerInvoiceRows ?? draft?.CustomerInvoiceDraftRows ?? [];
  return Boolean(registration && Array.isArray(rows) && rows.some((row: any) => String(row?.Text ?? "").toLowerCase().includes(registration)));
}

async function saveDraftIdForJob(jobId: string, draftId: string) {
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      visma_invoice_id: draftId,
      invoice_generated_at: new Date().toISOString(),
      invoice_error: null,
    })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
}

async function createVismaInvoiceDraft(userId: string, jobId: string, invoiceBody: Record<string, any>) {
  const draft = await vismaJson<{ Id: string }>(userId, "/v2/customerinvoicedrafts", {
    method: "POST",
    body: JSON.stringify(invoiceBody),
  });
  if (!draft.Id) throw new Error("Spiris returnerade inget id för fakturautkastet.");
  await saveDraftIdForJob(jobId, draft.Id);
  return { invoiceId: draft.Id, invoiceBody };
}

async function updateVismaInvoiceDraft(userId: string, draftId: string, invoiceBody: Record<string, any>): Promise<boolean> {
  const id = encodeURIComponent(draftId);
  const path = `/v2/customerinvoicedrafts/${id}`;
  const res = await vismaFetch(userId, path, {
    method: "PUT",
    body: JSON.stringify({ ...invoiceBody, Id: draftId }),
  });
  const text = await res.text();
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Kunde inte uppdatera fakturautkast i Spiris: PUT ${path} [${res.status}]: ${text.slice(0, 300)}`);
  return true;
}

async function ensureVismaInvoiceDraftForJob(userId: string, jobId: string, overrides: InvoiceOverrides = {}) {
  const { job, invoiceBody } = await buildVismaInvoiceBodyForJob(userId, jobId, overrides);
  const existingDraftId = (job.visma_invoice_id || "").trim();

  if (existingDraftId) {
    const existingDraft = await getVismaInvoiceDraft(userId, existingDraftId);
    if (existingDraft && draftBelongsToJob(existingDraft, job)) {
      const updated = await updateVismaInvoiceDraft(userId, existingDraftId, invoiceBody);
      if (updated) {
        await saveDraftIdForJob(jobId, existingDraftId);
        return { invoiceId: existingDraftId, invoiceBody };
      }
    }
  }

  return createVismaInvoiceDraft(userId, jobId, invoiceBody);
}

function compactDefined<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
}

function invoiceRowsForPreview(rows: any[] = []) {
  return rows.map((row, index) => compactDefined({
    LineNumber: row.LineNumber ?? index + 1,
    ArticleId: row.ArticleId,
    IsTextRow: row.IsTextRow,
    Text: row.Text,
    UnitPrice: row.UnitPrice,
    Quantity: row.Quantity ?? row.DeliveredQuantity,
    UnitAbbreviation: row.UnitAbbreviation,
    DiscountPercentage: row.DiscountPercentage,
    VatRate: row.VatRate,
    AccountingAccountId: row.AccountingAccountId,
    CostCenterItemId: row.CostCenterItemId,
    ProjectId: row.ProjectId,
    ReversedConstructionServicesVatFree: row.ReversedConstructionServicesVatFree ?? false,
  }));
}

function invoicePreviewBodyFromDraft(draft: any, fallback: Record<string, any> = {}) {
  const rows = draft?.Rows ?? draft?.CustomerInvoiceRows ?? draft?.CustomerInvoiceDraftRows ?? fallback.Rows ?? [];
  return compactDefined({
    ...fallback,
    CustomerId: draft?.CustomerId ?? fallback.CustomerId,
    InvoiceDate: draft?.InvoiceDate ?? fallback.InvoiceDate,
    DueDate: draft?.DueDate ?? fallback.DueDate,
    DeliveryDate: draft?.DeliveryDate ?? fallback.DeliveryDate,
    Currency: draft?.Currency ?? fallback.Currency ?? "SEK",
    EuThirdParty: draft?.EuThirdParty ?? fallback.EuThirdParty ?? false,
    RotReducedInvoicingType: draft?.RotReducedInvoicingType ?? fallback.RotReducedInvoicingType ?? 0,
    YourReference: draft?.YourReference ?? fallback.YourReference,
    OurReference: draft?.OurReference ?? fallback.OurReference,
    YourOrderNumber: draft?.YourOrderNumber ?? fallback.YourOrderNumber,
    IsCreditInvoice: draft?.IsCreditInvoice ?? fallback.IsCreditInvoice,
    Rows: invoiceRowsForPreview(rows),
  });
}

async function readVismaPdfResponse(res: Response, label: string): Promise<string> {
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`Visma PDF-förhandsgranskning misslyckades: ${label} [${res.status}]: ${buf.toString("utf8").slice(0, 300)}`);
  if (buf.slice(0, 4).toString("utf8") === "%PDF") return buf.toString("base64");

  const text = buf.toString("utf8").trim();
  try {
    const json = JSON.parse(text);
    if (typeof json?.Data === "string") return json.Data;
    if (typeof json?.data === "string") return json.data;
    const url = json?.Url || json?.url || json?.TemporaryUrl || json?.temporaryUrl;
    if (typeof url === "string" && url) {
      const pdfRes = await fetch(url);
      const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
      if (!pdfRes.ok) throw new Error(`Visma PDF-länk misslyckades [${pdfRes.status}]: ${pdfBuf.toString("utf8").slice(0, 200)}`);
      return pdfBuf.toString("base64");
    }
  } catch (e) {
    if (text.startsWith("JVBER")) return text;
    if (e instanceof Error && e.message.startsWith("Visma PDF-länk")) throw e;
  }
  if (text.startsWith("JVBER")) return text;
  throw new Error(`Oväntat svar från Visma PDF-förhandsgranskning: ${text.slice(0, 300)}`);
}

async function previewVismaInvoicePdf(userId: string, invoiceBody: Record<string, any>): Promise<string> {
  const path = "/v2/customerinvoices/preview";
  return readVismaPdfResponse(await vismaFetch(userId, path, {
    method: "POST",
    body: JSON.stringify(invoiceBody),
  }), `POST ${path}`);
}

export async function generateVismaInvoicePreviewPdfForJob(
  userId: string,
  jobId: string,
  overrides?: InvoiceOverrides,
): Promise<{ invoiceId: string; pdfBase64: string }> {
  const { data: job, error } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).eq("workshop_id", userId).single();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Jobbet hittades inte.");

  if (!overrides && job.visma_invoice_id) {
    const existingDraft = await getVismaInvoiceDraft(userId, job.visma_invoice_id);
    if (existingDraft && draftBelongsToJob(existingDraft, job)) {
      return {
        invoiceId: job.visma_invoice_id,
        pdfBase64: await previewVismaInvoicePdf(userId, invoicePreviewBodyFromDraft(existingDraft)),
      };
    }
  }

  const { invoiceId, invoiceBody } = await ensureVismaInvoiceDraftForJob(userId, jobId, overrides ?? {});
  const draft = await getVismaInvoiceDraft(userId, invoiceId);
  const previewBody = draft && draftBelongsToJob(draft, job)
    ? invoicePreviewBodyFromDraft(draft, invoiceBody)
    : invoiceBody;
  return { invoiceId, pdfBase64: await previewVismaInvoicePdf(userId, previewBody) };
}

export async function runDueInvoices(): Promise<{ processed: number; errors: number }> {
  const { data: jobs, error } = await supabaseAdmin
    .from("jobs")
    .select("id, created_by, workshop_id")
    .eq("current_status", "job_done")
    .lte("invoice_scheduled_at", new Date().toISOString())
    .is("invoice_generated_at", null);
  if (error) throw new Error(error.message);

  let processed = 0;
  let errors = 0;
  for (const j of jobs ?? []) {
    // Use workshop_id (the owner's user ID) so credentials are looked up on the right account.
    const effectiveUserId = (j as any).workshop_id ?? j.created_by;
    if (!effectiveUserId) continue;
    try {
      await generateVismaInvoiceForJob(effectiveUserId, j.id);
      processed++;
      // Auto-mark vehicle as picked up if workshop never did it manually,
      // archive the job and send the thank-you SMS with the review link.
      const { data: current } = await supabaseAdmin
        .from("jobs")
        .select("current_status, archived_at")
        .eq("id", j.id)
        .maybeSingle();
      if (current && current.current_status === "job_done" && !current.archived_at) {
        await supabaseAdmin.from("status_updates").insert({
          job_id: j.id,
          status: "car_picked_up",
          description: "Markerad upphämtad automatiskt när fakturan genererades.",
          created_by: effectiveUserId,
        });
        await supabaseAdmin
          .from("jobs")
          .update({
            current_status: "car_picked_up",
            archived_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", j.id);
        try {
          await sendPickupThanksSms(effectiveUserId, j.id);
        } catch (e) {
          console.error("Pickup SMS failed:", e);
        }
      }
    } catch (e: any) {
      errors++;
      await supabaseAdmin
        .from("jobs")
        .update({ invoice_error: (e?.message ?? "Unknown error").slice(0, 500) })
        .eq("id", j.id);
    }
  }
  return { processed, errors };
}

export async function disconnectVisma(userId: string) {
  const { error } = await supabaseAdmin.from("visma_connections").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}