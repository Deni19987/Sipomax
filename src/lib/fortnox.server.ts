import { createHash, createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rankCustomers } from "@/lib/customer-match";
import {
  aiRewrite,
  buildSummaryContext,
  loadJobBillable,
  QUOTE_LINE_PROMPT,
  SUMMARY_PROMPT,
  type InvoiceOverrides,
} from "./visma.server";

// Fortnox only has a single live environment for OAuth + API. We keep the
// "environment" column for parity with the Visma connection table.
export type FortnoxEnv = "production";

export const FORTNOX_URLS = {
  oauthAuthorize: "https://apps.fortnox.se/oauth-v1/auth",
  oauthToken: "https://apps.fortnox.se/oauth-v1/token",
  api: "https://api.fortnox.se/3",
} as const;

// Scopes required for full invoice functionality:
// - invoice: create/read/update invoices
// - print: render invoice PDFs via the /print and /preview endpoints. This is a
//   SEPARATE Fortnox scope from `invoice`; without it those endpoints reject the
//   application/pdf response with "Invalid response type" (error 1000030) even
//   though the invoice itself can be read/written as JSON.
// - customer: create/look up customer records (CustomerNumber required on every invoice)
// - article: read/create articles for invoice row lookups
// NOTE: the registered Fortnox integration must also have the "print" permission
// enabled, otherwise the authorize request fails with "unsupported scope".
// - settings: read account-level registries (e.g. /termsofpayments) that
//   aren't covered by the other scopes above.
// NOTE: adding a scope here only applies to *new* authorizations — an
// existing connection must be disconnected and reconnected in Settings for
// the wider scope to take effect (Fortnox doesn't retroactively grant scopes).
export const FORTNOX_SCOPES = "invoice print customer article companyinformation settings";

// Shown to the user (and surfaced in toasts) when Fortnox rejects the stored
// authorization — the only fix is to re-run the OAuth flow in Settings.
export const FORTNOX_RECONNECT_MESSAGE =
  "Fortnox-anslutningen har upphört att gälla. Återanslut Fortnox under Inställningar och försök igen.";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function stateSecret(): string {
  // Reuse the service role key as HMAC secret (never exposed to client),
  // same pattern as the Visma integration.
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signState(payload: { userId: string; ts: number }): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(token: string): { userId: string; ts: number } {
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

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = requireEnv("FORTNOX_CLIENT_ID");
  const url = new URL(FORTNOX_URLS.oauthAuthorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", FORTNOX_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  return url.toString();
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export interface FortnoxTokenError extends Error {
  fortnoxStatus?: number;
  fortnoxBody?: string;
}

async function tokenRequest(body: URLSearchParams) {
  const clientId = requireEnv("FORTNOX_CLIENT_ID");
  const clientSecret = requireEnv("FORTNOX_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  // Netlify's synchronous function timeout defaults to 10s. A token request
  // that outlives it gets the whole process killed AFTER Fortnox has rotated
  // (and invalidated) the refresh_token but BEFORE we persist the new one,
  // permanently wedging the connection. Keep this comfortably under 10s so a
  // slow Fortnox response fails cleanly inside our own process instead.
  const { signal, clear } = withTimeout(8_000);
  let res: Response;
  try {
    res = await fetch(FORTNOX_URLS.oauthToken, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Fortnox token request timed out after 8s");
    throw err;
  } finally {
    clear();
  }
  const text = await res.text();
  if (!res.ok) {
    // Log the raw OAuth error before mapping it to a friendly message —
    // otherwise the actual Fortnox response (which distinguishes an expired
    // refresh token from a rotated-away one from anything else) is lost.
    console.error(`[fortnox-token] request failed status=${res.status} body=${text.slice(0, 500)}`);
    // invalid_grant means the refresh/authorization token is no longer
    // accepted (expired or rotated away) — the connection must be
    // re-authorized. Surface an actionable message instead of the raw
    // OAuth error so the user knows exactly what to do.
    const isInvalidGrant = res.status === 400 && text.includes("invalid_grant");
    const err: FortnoxTokenError = new Error(
      isInvalidGrant ? FORTNOX_RECONNECT_MESSAGE : `Fortnox token error [${res.status}]: ${text.slice(0, 300)}`,
    );
    err.fortnoxStatus = res.status;
    err.fortnoxBody = text.slice(0, 500);
    throw err;
  }
  return JSON.parse(text) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }));
}

export async function refreshAccessToken(refreshToken: string) {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export async function storeFortnoxTokens(userId: string, tokens: { access_token: string; refresh_token: string; expires_in: number }) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();
  const row = {
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    environment: "production",
    updated_at: new Date().toISOString(),
    refreshing_at: null,
  };
  // Fortnox has already rotated (and invalidated) the previous refresh_token by
  // the time we get here, so failing to persist the new one permanently wedges
  // the connection — the next refresh would reuse a token Fortnox no longer
  // accepts. Retry a transient DB write failure a few times before giving up.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabaseAdmin
      .from("fortnox_connections")
      .upsert(row, { onConflict: "user_id" });
    if (!error) return;
    lastError = error;
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  throw new Error((lastError as { message?: string })?.message ?? "Kunde inte spara Fortnox-token");
}

export async function getFortnoxConnection(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("fortnox_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// De-duplicate concurrent refreshes for the same user within one process.
const inflightRefresh = new Map<string, Promise<string>>();

// In a serverless environment, concurrent requests for the same user often run
// in separate processes, so the in-memory inflightRefresh map above doesn't
// protect across them. Fortnox rotates the refresh_token on every use and
// immediately invalidates the previous one, so two processes that both read the
// same stale refresh_token and call Fortnox at once will race: one wins, the
// other gets invalid_grant — previously surfaced as a permanent "reconnect
// Fortnox" error even though the connection itself was fine.
//
// This claims an exclusive cross-process lock via an atomic UPDATE ... WHERE
// before calling Fortnox, so only one process ever attempts the rotation at a
// time. A stale lock (crashed process) expires after REFRESH_LOCK_TTL_MS so we
// never wedge the connection. Returns the refresh_token to use if we won the
// lock, or null if another process already holds it.
//
// Must stay comfortably longer than the winner's own worst-case duration
// (two 8s token-request attempts plus backoff and the DB write, see below)
// — otherwise a second claimer could steal a still-legitimate winner's lock
// mid-refresh, causing two concurrent rotations of the same refresh_token.
const REFRESH_LOCK_TTL_MS = 40_000;

async function claimRefreshLock(userId: string): Promise<string | null> {
  const cutoff = new Date(Date.now() - REFRESH_LOCK_TTL_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("fortnox_connections")
    .update({ refreshing_at: new Date().toISOString() })
    .eq("user_id", userId)
    .or(`refreshing_at.is.null,refreshing_at.lt.${cutoff}`)
    .select("refresh_token")
    .maybeSingle();
  if (error) throw new Error(error.message);
  console.log(`[fortnox-refresh] claim ${data ? "won" : "lost"} user=${userId}`);
  return data?.refresh_token ?? null;
}

async function clearRefreshLock(userId: string): Promise<void> {
  await supabaseAdmin.from("fortnox_connections").update({ refreshing_at: null }).eq("user_id", userId);
}

// Short stable identifier for a refresh token so the audit trail can prove
// WHICH token a refresh attempt spent, without ever storing the token itself.
function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export type FortnoxRefreshTrigger = "expiry-buffer" | "401-retry";

// Persistent audit trail (fortnox_refresh_events). Console logs go to Netlify
// function logs, which have short retention, no API access, and — crucially —
// cannot capture the worst failure mode at all: the process being killed
// between Fortnox rotating the refresh_token and us saving the new one. A row
// inserted BEFORE the token call and finalized after it means a row with
// finished_at IS NULL is direct evidence of a mid-rotation process death.
// Both helpers are best-effort: auditing must never break the refresh itself.
async function recordRefreshStart(row: {
  user_id: string;
  trigger_reason: FortnoxRefreshTrigger;
  attempt: number;
  token_fingerprint: string;
  old_expires_at: string | null;
}): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("fortnox_refresh_events")
      .insert(row)
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  } catch (e: any) {
    console.error(`[fortnox-refresh] audit insert failed user=${row.user_id} error=${e?.message}`);
    return null;
  }
}

async function recordRefreshFinish(
  eventId: number | null,
  patch: { outcome: "success" | "token-error" | "store-error"; error_status?: number | null; error_body?: string | null; duration_ms: number },
): Promise<void> {
  if (eventId == null) return;
  try {
    const { error } = await supabaseAdmin
      .from("fortnox_refresh_events")
      .update({ finished_at: new Date().toISOString(), ...patch })
      .eq("id", eventId);
    if (error) throw error;
  } catch (e: any) {
    console.error(`[fortnox-refresh] audit update failed event=${eventId} error=${e?.message}`);
  }
}

async function refreshAccessTokenForUser(userId: string, trigger: FortnoxRefreshTrigger = "expiry-buffer"): Promise<string> {
  const existing = inflightRefresh.get(userId);
  if (existing) return existing;
  const startedAt = Date.now();
  const p = (async () => {
    const conn = await getFortnoxConnection(userId);
    if (!conn) throw new Error("Fortnox is not connected for this user");

    const claimedRefreshToken = await claimRefreshLock(userId);
    if (claimedRefreshToken) {
      try {
        // The Fortnox token endpoint can be slow or blip transiently (its own
        // request already allows up to 8s). Retry once before giving up, so
        // a single network hiccup doesn't force a user-facing "reconnect
        // Fortnox" — only a genuine invalid_grant (the refresh_token itself
        // was rejected) is not worth retrying.
        let lastErr: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          const attemptStart = Date.now();
          // The audit row must be durably written BEFORE the token call —
          // it's the only record that survives if this process is killed
          // mid-rotation, so we intentionally await it.
          const eventId = await recordRefreshStart({
            user_id: userId,
            trigger_reason: trigger,
            attempt,
            token_fingerprint: tokenFingerprint(claimedRefreshToken),
            old_expires_at: conn.expires_at ?? null,
          });
          let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
          try {
            refreshed = await refreshAccessToken(claimedRefreshToken);
          } catch (err: any) {
            lastErr = err;
            await recordRefreshFinish(eventId, {
              outcome: "token-error",
              error_status: (err as FortnoxTokenError)?.fortnoxStatus ?? null,
              error_body: (err as FortnoxTokenError)?.fortnoxBody ?? String(err?.message ?? err).slice(0, 500),
              duration_ms: Date.now() - attemptStart,
            });
            console.error(`[fortnox-refresh] attempt failed user=${userId} attempt=${attempt} durationMs=${Date.now() - attemptStart} error=${err?.message}`);
            if (err?.message === FORTNOX_RECONNECT_MESSAGE) throw err;
            if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          // Fortnox has now rotated the refresh_token — from here on, failing
          // to persist it is the wedge case, so it gets its own audit outcome.
          try {
            await storeFortnoxTokens(userId, refreshed);
          } catch (err: any) {
            lastErr = err;
            await recordRefreshFinish(eventId, {
              outcome: "store-error",
              error_body: String(err?.message ?? err).slice(0, 500),
              duration_ms: Date.now() - attemptStart,
            });
            console.error(`[fortnox-refresh] token rotated but save failed user=${userId} attempt=${attempt} error=${err?.message}`);
            // Retrying with the same (now-invalidated) refresh token can only
            // yield invalid_grant — don't burn the retry on it.
            throw err;
          }
          await recordRefreshFinish(eventId, { outcome: "success", duration_ms: Date.now() - attemptStart });
          console.log(`[fortnox-refresh] success user=${userId} attempt=${attempt} durationMs=${Date.now() - attemptStart} totalMs=${Date.now() - startedAt}`);
          return refreshed.access_token;
        }
        throw lastErr;
      } catch (err: any) {
        console.error(`[fortnox-refresh] giving up user=${userId} totalMs=${Date.now() - startedAt} error=${err?.message}`);
        await clearRefreshLock(userId).catch((e) =>
          console.error(`[fortnox-refresh] clearRefreshLock failed user=${userId} error=${e?.message}`),
        );
        throw err;
      }
    }

    // Another process already holds the lock and is refreshing right now —
    // wait for it to finish and read back its result instead of racing it.
    // The winner's own attempt (including its retry above) can legitimately
    // take up to ~20s in the worst case (two 8s token-request timeouts plus
    // backoff, audit writes and the DB write), so this budget must comfortably
    // exceed that — a budget shorter than the winner's own timeout means a
    // slow-but-successful refresh would still cause every waiting request to
    // wrongly report "reconnect Fortnox" even though the connection was never
    // actually broken.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      const latest = await getFortnoxConnection(userId);
      if (!latest) break;
      if (new Date(latest.expires_at).getTime() > Date.now() + 30_000) {
        console.log(`[fortnox-refresh] waiter succeeded user=${userId} waitedMs=${Date.now() - startedAt}`);
        return latest.access_token;
      }
      // Winner released the lock without producing a fresh token — it
      // failed, so there's nothing more to wait for.
      if (!latest.refreshing_at) {
        console.error(`[fortnox-refresh] waiter: winner released lock without a fresh token user=${userId} waitedMs=${Date.now() - startedAt}`);
        break;
      }
    }
    console.error(`[fortnox-refresh] waiter gave up user=${userId} waitedMs=${Date.now() - startedAt}`);
    throw new Error(FORTNOX_RECONNECT_MESSAGE);
  })();
  inflightRefresh.set(userId, p);
  try {
    return await p;
  } finally {
    inflightRefresh.delete(userId);
  }
}

// Call this once before firing parallel Fortnox requests to ensure the token
// is fresh. All subsequent calls within the same process then hit the valid
// stored token and skip the refresh entirely.
export async function warmFortnoxToken(userId: string): Promise<void> {
  await getValidAccessToken(userId);
}

// Refresh proactively while the current access token still has plenty of
// life left (10 minutes), rather than waiting until it's nearly dead (the
// previous 30s buffer). If a refresh attempt is killed mid-flight — e.g. the
// underlying serverless invocation is torn down when the client request that
// triggered it disconnects — the still-valid old token remains usable for
// several more minutes, so the *next* attempt (from this request's own retry,
// or the next request that happens to come in) has a real chance to succeed
// with time to spare, instead of leaving the connection with nothing valid.
const TOKEN_REFRESH_BUFFER_MS = 10 * 60_000;

async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await getFortnoxConnection(userId);
  if (!conn) throw new Error("Fortnox is not connected for this user");
  if (new Date(conn.expires_at).getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return conn.access_token;
  }
  return refreshAccessTokenForUser(userId);
}

async function fortnoxFetch(userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getValidAccessToken(userId);
  const accept = (init.headers as Record<string, string> | undefined)?.Accept ?? "application/json";
  const hasBody = init.body != null;
  const doFetch = (t: string) => {
    const { signal, clear } = withTimeout(25_000);
    return fetch(`${FORTNOX_URLS.api}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${t}`,
        // Only send Content-Type when there is a body — sending it on GET
        // requests confuses some Fortnox endpoints (e.g. /preview returns 400).
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        Accept: accept,
        ...(init.headers ?? {}),
      },
      signal,
    }).catch((err: any) => {
      clear();
      if (err?.name === "AbortError") throw new Error(`Fortnox API ${path} timed out after 25s`);
      throw err;
    }).then((res) => { clear(); return res; });
  };
  let res = await doFetch(token);
  if (res.status === 401) {
    res = await doFetch(await refreshAccessTokenForUser(userId, "401-retry"));
  }
  return res;
}

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return Boolean(v);
}

function fortnoxErrorMessage(path: string, status: number, text: string): string {
  // Fortnox errors come back as { ErrorInformation: { message, code } }.
  try {
    const json = JSON.parse(text);
    const msg = json?.ErrorInformation?.message || json?.ErrorInformation?.Message;
    if (msg) return `Fortnox API ${path} [${status}]: ${String(msg).slice(0, 300)}`;
  } catch {
    // fall through to raw text
  }
  return `Fortnox API ${path} [${status}]: ${text.slice(0, 400)}`;
}

async function fortnoxJson<T = any>(userId: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fortnoxFetch(userId, path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(fortnoxErrorMessage(path, res.status, text));
  return text ? (JSON.parse(text) as T) : ({} as T);
}


interface FortnoxCustomerInput {
  name: string;
  email?: string;
  address?: string;
  zipCode?: string;
  city?: string;
}

export interface ArticleInvoiceOverrides {
  customerNumber?: string | null;
  customerName?: string;
  address?: string;
  zipCode?: string;
  city?: string;
  invoiceDate?: string;
  dueDate?: string;
  ourReference?: string;
  yourReference?: string;
  paymentTerms?: string;
}

async function findOrCreateFortnoxCustomer(userId: string, customer: FortnoxCustomerInput): Promise<string> {
  // Check the local cache first (covers all customers, not just first 500)
  const cached = await searchCustomersFromCache(userId, "");
  const lowerName = customer.name.trim().toLowerCase();
  const lowerEmail = customer.email?.trim().toLowerCase() ?? null;

  const cacheMatch = cached.find((c) =>
    (lowerEmail && c.email?.toLowerCase() === lowerEmail) ||
    c.name.toLowerCase() === lowerName,
  );
  if (cacheMatch?.customerNumber) return cacheMatch.customerNumber;

  // Fall back to live Fortnox email search in case cache is stale
  if (customer.email) {
    const searchPath = `/customers?email=${encodeURIComponent(customer.email.trim())}`;
    const searchRes = await fortnoxFetch(userId, searchPath, { method: "GET" });
    if (searchRes.ok) {
      const data = await searchRes.json() as any;
      const customers = data?.Customers ?? [];
      if (Array.isArray(customers) && customers.length > 0) {
        const existing = customers[0];
        const num = existing?.CustomerNumber;
        if (num) return String(num);
      }
    }
  }

  // Not found — create a new customer record
  const body: Record<string, any> = {
    Name: customer.name.trim().slice(0, 1024),
  };
  if (customer.email) body.Email = customer.email.trim();
  if (customer.address) body.Address1 = customer.address.trim().slice(0, 1024);
  if (customer.zipCode) body.ZipCode = String(customer.zipCode).trim();
  if (customer.city) body.City = customer.city.trim().slice(0, 1024);

  const created = await fortnoxJson<{ Customer?: { CustomerNumber?: string | number } }>(
    userId,
    "/customers",
    { method: "POST", body: JSON.stringify({ Customer: body }) },
  );
  const num = created?.Customer?.CustomerNumber;
  if (!num) throw new Error("Fortnox returnerade inget kundnummer vid skapande av kund.");
  return String(num);
}

export interface FortnoxCustomerResult {
  customerNumber: string;
  name: string;
  /** Personal first+last name when the official name is a company name */
  personalName?: string;
  email?: string;
  phone?: string;
  orgNumber?: string;
  address?: string;
  zipCode?: string;
  city?: string;
}

// Returns all digit variants for a phone string so Swedish formats match regardless of
// how the number is stored (070…, +4670…, 004670…) or entered.
function phoneDigitVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  if (!d) return [];
  const variants = new Set([d]);
  if (d.startsWith("0046")) { variants.add(d.slice(2)); variants.add("0" + d.slice(4)); }
  else if (d.startsWith("46") && d.length >= 10) { variants.add("0" + d.slice(2)); variants.add("0046" + d.slice(2)); }
  else if (d.startsWith("0") && d.length >= 9) { variants.add("46" + d.slice(1)); variants.add("0046" + d.slice(1)); }
  return [...variants];
}

// True when the customer matches the (already lowercased) query across any of
// name, number, email, org nr, address, city or phone (digit-variant aware).
export function customerMatchesQuery(c: FortnoxCustomerResult, q: string): boolean {
  if (!q) return true; // empty query — match all
  const name = (c.name ?? "").toLowerCase();
  const num = String(c.customerNumber ?? "");
  const email = (c.email ?? "").toLowerCase();
  const orgNum = (c.orgNumber ?? "").replace(/\D/g, "");
  const address = (c.address ?? "").toLowerCase();
  const city = (c.city ?? "").toLowerCase();
  const storedPhoneVariants = phoneDigitVariants(c.phone ?? "");
  const qPhoneVariants = phoneDigitVariants(q);

  if (name.includes(q) || num.includes(q) || email.includes(q)) return true;
  if (address.includes(q)) return true;
  if (city.includes(q)) return true;
  if (orgNum && orgNum.includes(q.replace(/\D/g, ""))) return true;
  if (qPhoneVariants.length > 0 && storedPhoneVariants.length > 0) {
    for (const qv of qPhoneVariants) {
      if (qv.length >= 4 && storedPhoneVariants.some((sv) => sv.includes(qv) || qv.includes(sv))) return true;
    }
  }
  return false;
}

// Fetch the workshop's full customer list straight from Fortnox (no filtering).
// Used to (re)populate the local cache. Fortnox has no reliable free-text
// customer search, so we pull up to 500 and search locally.
export async function fetchAllFortnoxCustomers(userId: string): Promise<FortnoxCustomerResult[]> {
  const all: FortnoxCustomerResult[] = [];
  let page = 1;
  while (true) {
    const res = await fortnoxFetch(userId, `/customers?limit=500&page=${page}`, { method: "GET" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fortnox customer search failed [${res.status}]: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as any;
    const customers: any[] = Array.isArray(data?.Customers) ? data.Customers : [];
    for (const c of customers) {
      all.push({
        customerNumber: String(c.CustomerNumber ?? ""),
        name: c.Name ?? "",
        email: c.Email || undefined,
        phone: c.Phone || c.Telephone1 || undefined,
        orgNumber: c.OrganisationNumber || undefined,
        address: c.Address1 || undefined,
        zipCode: c.ZipCode || undefined,
        city: c.City || undefined,
      });
    }
    // Fortnox prefixes meta fields with "@" (e.g. "@TotalPages")
    const totalPages = Number(data?.MetaInformation?.["@TotalPages"] ?? 1);
    if (page >= totalPages || customers.length === 0) break;
    page++;
  }
  return all;
}

export async function searchFortnoxCustomers(
  userId: string,
  query: string,
): Promise<FortnoxCustomerResult[]> {
  const all = await fetchAllFortnoxCustomers(userId);
  const q = query.trim().toLowerCase();
  return all.filter((c) => customerMatchesQuery(c, q)).slice(0, 100);
}

export interface CreateFortnoxCustomerResult {
  customerNumber: string;
  alreadyExists: boolean;
}

export async function updateFortnoxCustomerDirect(
  userId: string,
  customerNumber: string,
  updates: { name?: string; phone?: string; email?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string; termsOfPayment?: string },
): Promise<void> {
  const body: Record<string, any> = {};
  if (updates.name !== undefined) body.Name = updates.name.trim().slice(0, 1024);
  // Fortnox's customer resource uses Phone1/Phone2 — "Phone" isn't a real
  // field on write, it just gets silently dropped (the list endpoint returns
  // it as a convenience alias on read, which is why it looked like it worked).
  if (updates.phone !== undefined) body.Phone1 = updates.phone.trim();
  if (updates.email !== undefined) body.Email = updates.email.trim();
  if (updates.orgNumber !== undefined) body.OrganisationNumber = updates.orgNumber.trim();
  if (updates.address !== undefined) body.Address1 = updates.address.trim();
  if (updates.zipCode !== undefined) body.ZipCode = String(updates.zipCode).replace(/[^0-9 ]/g, "").trim();
  if (updates.city !== undefined) body.City = updates.city.trim();
  // The customer's default payment terms (a Code from the account's registry).
  // Keeping this in sync means Sipomax and Fortnox always agree on the terms.
  if (updates.termsOfPayment !== undefined) body.TermsOfPayment = updates.termsOfPayment.trim();
  if (Object.keys(body).length === 0) return;
  await fortnoxFetch(userId, `/customers/${encodeURIComponent(customerNumber)}`, {
    method: "PUT",
    body: JSON.stringify({ Customer: body }),
  });
  // Reflect the change in the local cache so the next search shows fresh data.
  // Terms aren't part of the search cache, so exclude them from the patch.
  const { termsOfPayment: _terms, ...cacheUpdates } = updates;
  await patchCustomerCacheRow(userId, customerNumber, cacheUpdates).catch((e) =>
    console.error("Fortnox customer cache patch failed", e),
  );
}

// Read a customer's default payment terms straight from Fortnox. Used so that a
// terms change made in Fortnox is reflected in Sipomax the next time the
// customer is selected on an invoice (Fortnox → Sipomax direction).
export async function getFortnoxCustomerDefaults(
  userId: string,
  customerNumber: string,
): Promise<{ termsOfPayment: string | null }> {
  const res = await fortnoxFetch(userId, `/customers/${encodeURIComponent(customerNumber)}`, { method: "GET" });
  if (!res.ok) return { termsOfPayment: null };
  const data = await res.json().catch(() => null) as any;
  const terms = data?.Customer?.TermsOfPayment;
  return { termsOfPayment: terms != null && String(terms).trim() ? String(terms).trim() : null };
}

export async function createFortnoxCustomerDirect(
  userId: string,
  customer: { name: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string },
): Promise<CreateFortnoxCustomerResult> {
  // Duplicate check against local cache (covers all customers, not just first 500)
  const cached = await searchCustomersFromCache(userId, "");
  const lowerName = customer.name.trim().toLowerCase();
  const lowerEmail = customer.email?.trim().toLowerCase() ?? null;
  const cacheMatch = cached.find((c) =>
    (lowerEmail && c.email?.toLowerCase() === lowerEmail) ||
    c.name.toLowerCase() === lowerName,
  );
  if (cacheMatch?.customerNumber) {
    // The cache can be up to CACHE_MAX_AGE_MS stale (e.g. the customer was
    // just deleted in Fortnox), so confirm it's still actually there before
    // blocking creation as a duplicate.
    const verifyRes = await fortnoxFetch(userId, `/customers/${encodeURIComponent(cacheMatch.customerNumber)}`, { method: "GET" });
    if (verifyRes.ok) {
      return { customerNumber: cacheMatch.customerNumber, alreadyExists: true };
    }
    try {
      await supabaseAdmin
        .from("fortnox_customers_cache")
        .delete()
        .eq("workshop_id", userId)
        .eq("customer_number", cacheMatch.customerNumber);
    } catch (e) {
      console.error("Fortnox customer cache cleanup failed", e);
    }
  }

  // Fall back to live Fortnox email search in case cache is stale
  if (customer.email) {
    const res = await fortnoxFetch(userId, `/customers?email=${encodeURIComponent(customer.email.trim())}`, { method: "GET" });
    if (res.ok) {
      const data = await res.json() as any;
      const existing = (data?.Customers ?? [])[0];
      if (existing?.CustomerNumber) return { customerNumber: String(existing.CustomerNumber), alreadyExists: true };
    }
  }
  const body: Record<string, any> = { Name: customer.name.trim().slice(0, 1024) };
  if (customer.email) body.Email = customer.email.trim();
  if (customer.phone) body.Phone1 = customer.phone.trim();
  if (customer.orgNumber) body.OrganisationNumber = customer.orgNumber.trim();
  if (customer.address) body.Address1 = customer.address.trim().slice(0, 1024);
  if (customer.zipCode) body.ZipCode = String(customer.zipCode).replace(/[^0-9 ]/g, "").trim();
  if (customer.city) body.City = customer.city.trim().slice(0, 1024);
  const created = await fortnoxJson<{ Customer?: { CustomerNumber?: string | number } }>(
    userId, "/customers", { method: "POST", body: JSON.stringify({ Customer: body }) },
  );
  const num = created?.Customer?.CustomerNumber;
  if (!num) throw new Error("Fortnox returnerade inget kundnummer vid skapande av kund.");
  const customerNumber = String(num);
  await upsertCustomerCacheRow(userId, {
    customerNumber,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    orgNumber: customer.orgNumber,
    address: customer.address,
    zipCode: customer.zipCode,
    city: customer.city,
  }).catch((e) => console.error("Fortnox customer cache upsert failed", e));
  return { customerNumber, alreadyExists: false };
}

export interface FortnoxArticleResult {
  articleNumber: string;
  description: string;
  salesPrice: number | null;
  unit: string | null;
  vat: number | null;
}

export interface CreateFortnoxArticleResult {
  articleNumber: string;
  alreadyExists: boolean;
}

export async function createFortnoxArticle(
  userId: string,
  article: { articleNumber?: string; description: string; salesPrice?: number; unit?: string; vat?: number },
): Promise<CreateFortnoxArticleResult> {
  const suppliedNum = article.articleNumber?.trim() ?? "";
  // Only check for duplicates when the caller supplied a number
  if (suppliedNum) {
    const enc = encodeURIComponent(suppliedNum);
    const existing = await fortnoxJson<{ Articles?: any[] }>(userId, `/articles?articlenumber=${enc}&limit=1`).catch(() => null);
    if (existing?.Articles?.length) {
      return { articleNumber: suppliedNum, alreadyExists: true };
    }
  }
  const body: Record<string, any> = {
    Description: article.description.trim().slice(0, 200),
  };
  if (suppliedNum) body.ArticleNumber = suppliedNum;
  // SalesPrice is read-only on POST in Fortnox — set it via PUT after creation
  if (article.unit) body.Unit = article.unit.trim().slice(0, 10);
  if (article.vat != null) body.VAT = article.vat;
  const created = await fortnoxJson<{ Article?: { ArticleNumber?: string } }>(
    userId, "/articles", { method: "POST", body: JSON.stringify({ Article: body }) },
  );
  const num = created?.Article?.ArticleNumber;
  if (!num) throw new Error("Fortnox returnerade inget artikelnummer vid skapande av artikel.");
  await upsertArticleCacheRow(userId, {
    articleNumber: num,
    description: article.description,
    salesPrice: article.salesPrice ?? null,
    unit: article.unit ?? null,
    vat: article.vat ?? null,
  }).catch((e) => console.error("Fortnox article cache upsert failed", e));
  return { articleNumber: num, alreadyExists: false };
}

export async function updateFortnoxArticle(
  userId: string,
  currentArticleNumber: string,
  updates: { articleNumber?: string; description?: string; salesPrice?: number; unit?: string; vat?: number },
): Promise<{ articleNumber: string }> {
  const body: Record<string, any> = {};
  if (updates.articleNumber != null) body.ArticleNumber = updates.articleNumber.trim();
  if (updates.description != null) body.Description = updates.description.trim().slice(0, 200);
  if (updates.salesPrice != null) body.SalesPrice = updates.salesPrice;
  if (updates.unit != null) body.Unit = updates.unit.trim().slice(0, 10);
  if (updates.vat != null) body.VAT = updates.vat;
  const enc = encodeURIComponent(currentArticleNumber);
  const updated = await fortnoxJson<{ Article?: { ArticleNumber?: string } }>(
    userId,
    `/articles/${enc}`,
    { method: "PUT", body: JSON.stringify({ Article: body }) },
  );
  const num = updated?.Article?.ArticleNumber ?? currentArticleNumber;
  // Update cache to reflect new number
  await upsertArticleCacheRow(userId, {
    articleNumber: num,
    description: updates.description ?? "",
    salesPrice: updates.salesPrice ?? null,
    unit: updates.unit ?? null,
    vat: updates.vat ?? null,
  }).catch((e) => console.error("Fortnox article cache upsert failed after update", e));
  if (num !== currentArticleNumber) {
    try {
      await supabaseAdmin
        .from("fortnox_articles_cache")
        .delete()
        .eq("workshop_id", userId)
        .eq("article_number", currentArticleNumber);
    } catch { /* best-effort cache cleanup */ }
  }
  return { articleNumber: num };
}

export async function deleteFortnoxArticle(userId: string, articleNumber: string): Promise<void> {
  const enc = encodeURIComponent(articleNumber);
  await fortnoxFetch(userId, `/articles/${enc}`, { method: "DELETE" });
  try {
    await supabaseAdmin
      .from("fortnox_articles_cache")
      .delete()
      .eq("workshop_id", userId)
      .eq("article_number", articleNumber);
  } catch { /* best-effort */ }
}

// Fortnox rejects invisible Unicode and several "smart" punctuation characters in
// invoice text fields. Keep Swedish Latin text, but normalize everything else to
// plain printable characters before sending invoice payloads.
function sanitizeFortnoxText(text: string, maxLen: number): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/[""„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[•·]/g, "-")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E\xC0-\xFF]/g, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizeFortnoxInvoicePayload<T>(value: T): T {
  if (typeof value === "string") return sanitizeFortnoxText(value, 1024) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeFortnoxInvoicePayload(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sanitizeFortnoxInvoicePayload(nested)]),
    ) as T;
  }
  return value;
}

async function buildFortnoxInvoiceBodyForJob(userId: string, jobId: string, overrides: InvoiceOverrides = {}) {
  const { job, billable, nonBillable, messages } = await loadJobBillable(jobId, userId);
  const lineTexts: string[] = overrides.line_texts && overrides.line_texts.length === billable.length
    ? overrides.line_texts
    : await Promise.all(
        billable.map(async (u: any) => aiRewrite(QUOTE_LINE_PROMPT, u.description || "Godkänd offert")),
      );

  const workSummary = overrides.summary_text !== undefined
    ? (overrides.summary_text || "").trim()
    : ((nonBillable.length || messages.length)
        ? await aiRewrite(SUMMARY_PROMPT, buildSummaryContext(nonBillable, messages))
        : "");

  const rows: any[] = [];

  // Header text row with vehicle reference.
  const vehicle = [job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ");
  const idLabel = (job as any).identifier_type === "article" ? "Art.nr" : "Reg.nr";
  rows.push({ Description: sanitizeFortnoxText(`${idLabel}: ${job.registration_number}${vehicle ? ` - ${vehicle}` : ""}`, 50) });

  // Billable lines — no ArticleNumber needed; VAT and price set directly.
  billable.forEach((u: any, i: number) => {
    const amount =
      overrides.line_amounts && overrides.line_amounts[i] != null
        ? Number(overrides.line_amounts[i])
        : Number(u.quote_amount);
    rows.push({
      Description: sanitizeFortnoxText(lineTexts[i] || u.description || "Utfört arbete", 50),
      DeliveredQuantity: "1",
      Price: amount,
      VAT: 25,
    });
  });

  // Informational summary as a trailing text row.
  if (workSummary) {
    rows.push({ Description: sanitizeFortnoxText(`Utfört arbete: ${workSummary}`, 50) });
  }

  // Prefer the customer already linked to the job — matching by name/email can
  // pick the wrong record or create a duplicate when the name was edited.
  // Only fall back to find-or-create when the job has no linked customer.
  const linkedCustomerNumber = (job.fortnox_customer_number || "").trim();
  const customerNumber = linkedCustomerNumber || await findOrCreateFortnoxCustomer(userId, {
    name: sanitizeFortnoxText(job.customer_name || "Kund", 1024),
    email: job.customer_email || undefined,
    address: job.billing_address ? sanitizeFortnoxText(job.billing_address, 1024) : undefined,
    zipCode: job.billing_postal_code || undefined,
    city: job.billing_city ? sanitizeFortnoxText(job.billing_city, 1024) : undefined,
  });

  const today = new Date().toISOString().slice(0, 10);
  const invoice: Record<string, any> = {
    CustomerNumber: customerNumber,
    ...(job.customer_email ? { EmailInformation: { EmailAddressTo: job.customer_email.trim() } } : {}),
    InvoiceDate: overrides.invoice_date || today,
    Currency: "SEK",
    InvoiceRows: rows,
    YourReference: sanitizeFortnoxText(overrides.your_reference || job.customer_name || "", 50),
    OurReference: sanitizeFortnoxText(overrides.our_reference || job.registration_number || "", 50),
  };
  if (overrides.due_date) invoice.DueDate = overrides.due_date;
  if (overrides.your_order_reference) invoice.ExternalInvoiceReference1 = sanitizeFortnoxText(overrides.your_order_reference, 50);
  if (workSummary) invoice.Remarks = sanitizeFortnoxText(workSummary, 1000);
  // Note: credit invoices in Fortnox are created via POST /invoices/{id}/credit
  // (an action on an existing booked invoice), not by setting a Credit field on the
  // invoice body. The Credit property is read-only on the Invoice resource.

  return { job, invoiceBody: sanitizeFortnoxInvoicePayload({ Invoice: invoice }), isCreditInvoice: !!overrides.is_credit_invoice };
}

async function saveInvoiceIdForJob(jobId: string, documentNumber: string, workshopId?: string) {
  // Scope the write to the owning workshop when we know it, so a stray job id
  // can never repoint another workshop's job at this invoice.
  let q = supabaseAdmin
    .from("jobs")
    .update({
      fortnox_invoice_id: documentNumber,
      invoice_generated_at: new Date().toISOString(),
      invoice_error: null,
    })
    .eq("id", jobId);
  if (workshopId) q = q.eq("workshop_id", workshopId);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export async function getFortnoxInvoice(userId: string, documentNumber: string): Promise<any | null> {
  const id = encodeURIComponent(documentNumber);
  const path = `/invoices/${id}`;
  const res = await fortnoxFetch(userId, path, { method: "GET" });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(fortnoxErrorMessage(path, res.status, text));
  return text ? JSON.parse(text)?.Invoice ?? null : null;
}

function invoiceBelongsToJob(invoice: any, job: any): boolean {
  const jobRef = `Job ${String(job.id).slice(0, 8)}`;
  const ourReference = String(invoice?.OurReference ?? "").trim();
  if (ourReference === jobRef || ourReference.includes(String(job.id).slice(0, 8))) return true;
  const registration = String(job.registration_number ?? "").trim().toLowerCase();
  const rows = invoice?.InvoiceRows ?? [];
  return Boolean(registration && Array.isArray(rows) && rows.some((row: any) => String(row?.Description ?? "").toLowerCase().includes(registration)));
}

async function ensureFortnoxInvoiceForJob(userId: string, jobId: string, overrides: InvoiceOverrides = {}) {
  const { job, invoiceBody } = await buildFortnoxInvoiceBodyForJob(userId, jobId, overrides);
  // isCreditInvoice is captured but credit invoices require a separate /credit action
  // on an already-booked invoice — not implemented yet; falls through to normal flow.
  const existingId = (job.fortnox_invoice_id || "").trim();

  if (existingId) {
    const existing = await getFortnoxInvoice(userId, existingId);
    // Only update invoices that haven't been booked/cancelled yet.
    if (existing && invoiceBelongsToJob(existing, job) && !existing.Booked && !existing.Cancelled) {
      const id = encodeURIComponent(existingId);
      const path = `/invoices/${id}`;
      const res = await fortnoxFetch(userId, path, { method: "PUT", body: JSON.stringify(invoiceBody) });
      const text = await res.text();
      if (res.ok) {
        await saveInvoiceIdForJob(jobId, existingId, userId);
        return { invoiceId: existingId, invoiceBody };
      }
      if (res.status !== 404) throw new Error(fortnoxErrorMessage(path, res.status, text));
    }
  }

  const created = await fortnoxJson<{ Invoice?: { DocumentNumber: number | string } }>(userId, "/invoices", {
    method: "POST",
    body: JSON.stringify(invoiceBody),
  });
  const documentNumber = created.Invoice?.DocumentNumber;
  if (documentNumber == null) throw new Error("Fortnox returnerade inget fakturanummer.");
  await saveInvoiceIdForJob(jobId, String(documentNumber), userId);
  return { invoiceId: String(documentNumber), invoiceBody };
}

export async function generateFortnoxInvoiceForJob(
  userId: string,
  jobId: string,
  overrides: InvoiceOverrides = {},
): Promise<{ invoiceId: string }> {
  const { invoiceId } = await ensureFortnoxInvoiceForJob(userId, jobId, overrides);
  return { invoiceId };
}

export interface FortnoxPaymentTerm {
  code: string;
  numberOfDays: number | null;
}

// One-off diagnostic: returns the raw Fortnox response for /termsofpayments
// so a 403 (missing scope, needs reconnect) can be told apart from a 200
// with an empty/differently-shaped body (wrong field names in our parsing).
export async function debugFortnoxPaymentTermsRaw(userId: string): Promise<{ status: number; body: string }> {
  const res = await fortnoxFetch(userId, "/termsofpayments", { method: "GET" });
  const body = await res.text();
  return { status: res.status, body: body.slice(0, 4000) };
}

// Fortnox invoices don't accept an arbitrary "days" value for TermsOfPayment
// — it must be the Code of one of the account's own predefined payment-terms
// records (configured in Fortnox under Inställningar > Fakturering >
// Betalningsvillkor), so the codes differ per account. List them from the
// account's own registry rather than assuming a fixed set.
export async function getFortnoxPaymentTerms(userId: string): Promise<FortnoxPaymentTerm[]> {
  // Requires the "settings" OAuth scope — a connection authorized before that
  // scope was added will 403 here and needs to be reconnected in Settings.
  const data = await fortnoxJson<any>(userId, "/termsofpayments", { method: "GET" });
  const terms: any[] = data?.TermsOfPayments ?? [];
  return terms
    .map((t) => ({
      code: String(t?.Code ?? "").trim(),
      numberOfDays: t?.NumberOfDays != null ? Number(t.NumberOfDays) : null,
    }))
    .filter((t) => t.code);
}

async function getFortnoxDefaultPrintTemplate(userId: string): Promise<string | null> {
  const res = await fortnoxFetch(userId, "/printtemplates?type=invoice", { method: "GET" });
  if (!res.ok) return null;
  try {
    const data = await res.json() as any;
    const templates: any[] = data?.PrintTemplates ?? [];
    const def = templates.find((t) => t?.DefaultTemplate === true);
    return (def?.Template as string | undefined) ?? (templates[0]?.Template as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function fetchFortnoxInvoicePdf(userId: string, documentNumber: string): Promise<string> {
  const id = encodeURIComponent(documentNumber);
  const path = `/invoices/${id}/preview`;

  // Fortnox's print/preview endpoints return a JSON envelope with a base64-encoded
  // PDF in the "Document" field — NOT a raw binary PDF. Sending Accept: application/pdf
  // causes a 400 "Invalid response type" because the endpoint only speaks JSON.
  const res = await fortnoxFetch(userId, path, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(fortnoxErrorMessage(path, res.status, text));
  }
  let data: any;
  try { data = JSON.parse(text); } catch {
    // If Fortnox returns raw binary (content-type application/pdf), encode it directly.
    if (res.headers.get("content-type")?.includes("application/pdf")) {
      return Buffer.from(text, "binary").toString("base64");
    }
    throw new Error(`Fortnox preview returnerade ett oväntat svar.`);
  }
  // The base64 PDF lives at different keys depending on the endpoint version.
  const b64 = data?.Document ?? data?.File ?? data?.PreviewPDF ?? data?.PDF;
  if (!b64) {
    throw new Error(`Fortnox preview saknar PDF-data i svaret: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return b64 as string;
}

export async function generateFortnoxInvoicePreviewPdfForJob(
  userId: string,
  jobId: string,
  overrides?: InvoiceOverrides,
): Promise<{ invoiceId: string; pdfBase64: string }> {
  const { data: job, error } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).eq("workshop_id", userId).single();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Jobbet hittades inte.");

  // Fortnox has no pre-create preview endpoint, so we ensure the invoice exists
  // (creating or updating it) and then render its PDF preview.
  const { invoiceId } = await ensureFortnoxInvoiceForJob(userId, jobId, overrides ?? {});
  return { invoiceId, pdfBase64: await fetchFortnoxInvoicePdf(userId, invoiceId) };
}

export async function fetchFortnoxInvoicePdfForJob(userId: string, documentNumber: string): Promise<string> {
  return fetchFortnoxInvoicePdf(userId, documentNumber);
}

export async function cancelPreviewInvoice(userId: string, jobId: string, invoiceId: string): Promise<void> {
  const id = encodeURIComponent(invoiceId);
  // Best-effort: try to cancel in Fortnox; don't throw if it fails (already booked, etc.)
  try {
    await fortnoxFetch(userId, `/invoices/${id}/cancel`, { method: "PUT" });
  } catch {
    try { await fortnoxFetch(userId, `/invoices/${id}`, { method: "DELETE" }); } catch { /* ignored */ }
  }
  // Always clear the invoice reference from the job so it can be re-invoiced.
  // Scoped to the owning workshop so a stray job id can't wipe another
  // workshop's invoice link.
  await supabaseAdmin.from("jobs").update({
    fortnox_invoice_id: null,
    invoice_generated_at: null,
  } as any).eq("id", jobId).eq("workshop_id", userId);
}

export async function disconnectFortnox(userId: string) {
  const { error } = await supabaseAdmin.from("fortnox_connections").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Article search + article-based invoicing
// ---------------------------------------------------------------------------

// Search the user's Fortnox articles by number, name or content. Fortnox has no
// single free-text endpoint, so we query the two documented "contains" filters
// (articlenumber + description) in parallel and merge them. A short query still
// returns useful matches; results are de-duplicated and capped for the picker.
export async function searchFortnoxArticles(userId: string, query: string): Promise<FortnoxArticleResult[]> {
  const q = query.trim();

  let rawArticles: any[];
  if (!q) {
    // Empty query — fetch all articles to populate the initial dropdown
    const data = await fortnoxJson<{ Articles?: any[] }>(userId, `/articles?limit=200`).catch(() => ({ Articles: [] }));
    rawArticles = data.Articles ?? [];
  } else {
    const enc = encodeURIComponent(q);
    await warmFortnoxToken(userId);
    const [byNumber, byDescription] = await Promise.all([
      fortnoxJson<{ Articles?: any[] }>(userId, `/articles?articlenumber=${enc}&limit=50`).catch(() => ({ Articles: [] })),
      fortnoxJson<{ Articles?: any[] }>(userId, `/articles?description=${enc}&limit=50`).catch(() => ({ Articles: [] })),
    ]);
    rawArticles = [...(byNumber.Articles ?? []), ...(byDescription.Articles ?? [])];
  }

  const lower = q.toLowerCase();
  const seen = new Set<string>();
  const results: FortnoxArticleResult[] = [];
  for (const a of rawArticles) {
    const num = String(a?.ArticleNumber ?? "").trim();
    if (!num || seen.has(num)) continue;
    const desc = String(a?.Description ?? "");
    if (q && !num.toLowerCase().includes(lower) && !desc.toLowerCase().includes(lower)) continue;
    seen.add(num);
    results.push({
      articleNumber: num,
      description: desc,
      salesPrice: a?.SalesPrice != null ? Number(a.SalesPrice) : null,
      unit: a?.Unit ?? null,
      vat: a?.VAT != null ? Number(a.VAT) : null,
    });
    if (results.length >= 100) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Local cache of Fortnox customers + articles (per workshop)
//
// Searching used to hit the Fortnox API on every keystroke. These helpers mirror
// the workshop's Fortnox data into Supabase so search runs locally. The cache is
// refreshed in the background when older than CACHE_MAX_AGE_MS, and patched
// immediately whenever a customer/article is created or edited.
// ---------------------------------------------------------------------------

const CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const inflightCacheSync = new Map<string, Promise<void>>();

function buildCustomerSearchText(c: FortnoxCustomerResult): string {
  const phoneVariants = phoneDigitVariants(c.phone ?? "").join(" ");
  return [c.name, c.customerNumber, c.email, c.orgNumber, c.address, c.city, c.phone, phoneVariants]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function cacheRowToCustomer(r: any): FortnoxCustomerResult {
  return {
    customerNumber: String(r.customer_number ?? ""),
    name: r.name ?? "",
    email: r.email || undefined,
    phone: r.phone || undefined,
    orgNumber: r.org_number || undefined,
    address: r.address || undefined,
    zipCode: r.zip_code || undefined,
    city: r.city || undefined,
  };
}

function customerToCacheRow(workshopId: string, c: FortnoxCustomerResult, stamp: string) {
  return {
    workshop_id: workshopId,
    customer_number: c.customerNumber,
    name: c.name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    org_number: c.orgNumber ?? null,
    address: c.address ?? null,
    zip_code: c.zipCode ?? null,
    city: c.city ?? null,
    search_text: buildCustomerSearchText(c),
    updated_at: stamp,
  };
}

async function getCacheSyncedAt(workshopId: string, kind: "customers" | "articles"): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("fortnox_cache_meta")
    .select("synced_at")
    .eq("workshop_id", workshopId)
    .eq("kind", kind)
    .maybeSingle();
  return data?.synced_at ? new Date(data.synced_at).getTime() : null;
}

async function setCacheSyncedAt(workshopId: string, kind: "customers" | "articles") {
  await supabaseAdmin
    .from("fortnox_cache_meta")
    .upsert({ workshop_id: workshopId, kind, synced_at: new Date().toISOString() }, { onConflict: "workshop_id,kind" });
}

export async function upsertCustomerCacheRow(workshopId: string, c: FortnoxCustomerResult): Promise<void> {
  if (!c.customerNumber) return;
  const { error } = await supabaseAdmin
    .from("fortnox_customers_cache")
    .upsert(customerToCacheRow(workshopId, c, new Date().toISOString()), { onConflict: "workshop_id,customer_number" });
  if (error) throw new Error(error.message);
}

// Merge partial updates onto the cached customer (preserving fields we aren't
// changing) and recompute the search text.
async function patchCustomerCacheRow(
  workshopId: string,
  customerNumber: string,
  updates: { name?: string; phone?: string; email?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string },
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("fortnox_customers_cache")
    .select("*")
    .eq("workshop_id", workshopId)
    .eq("customer_number", customerNumber)
    .maybeSingle();
  const base = existing ? cacheRowToCustomer(existing) : { customerNumber, name: "" } as FortnoxCustomerResult;
  const merged: FortnoxCustomerResult = {
    customerNumber,
    name: updates.name ?? base.name ?? "",
    email: updates.email ?? base.email,
    phone: updates.phone ?? base.phone,
    orgNumber: updates.orgNumber ?? base.orgNumber,
    address: updates.address ?? base.address,
    zipCode: updates.zipCode ?? base.zipCode,
    city: updates.city ?? base.city,
  };
  await upsertCustomerCacheRow(workshopId, merged);
}

export async function syncFortnoxCustomersCache(workshopId: string): Promise<void> {
  const all = await fetchAllFortnoxCustomers(workshopId);
  const stamp = new Date().toISOString();
  const rows = all.filter((c) => c.customerNumber).map((c) => customerToCacheRow(workshopId, c, stamp));
  if (rows.length) {
    const { error } = await supabaseAdmin
      .from("fortnox_customers_cache")
      .upsert(rows, { onConflict: "workshop_id,customer_number" });
    if (error) throw new Error(error.message);
    // Drop rows for customers that no longer exist in Fortnox (older stamp).
    await supabaseAdmin.from("fortnox_customers_cache").delete().eq("workshop_id", workshopId).lt("updated_at", stamp);
  } else {
    await supabaseAdmin.from("fortnox_customers_cache").delete().eq("workshop_id", workshopId);
  }
  await setCacheSyncedAt(workshopId, "customers");
}

async function ensureCustomersCacheFresh(workshopId: string): Promise<void> {
  const syncedAt = await getCacheSyncedAt(workshopId, "customers");
  if (syncedAt != null && Date.now() - syncedAt < CACHE_MAX_AGE_MS) return;
  const key = `customers:${workshopId}`;
  let p = inflightCacheSync.get(key);
  if (!p) {
    p = syncFortnoxCustomersCache(workshopId)
      .catch((e) => console.error("Fortnox customer cache sync failed", e))
      .finally(() => inflightCacheSync.delete(key));
    inflightCacheSync.set(key, p);
  }
  // Never synced yet → wait so the first search has data. Otherwise refresh in
  // the background and serve the (slightly stale) cache immediately.
  if (syncedAt == null) await p;
}

// The whole workshop's current customer details, straight from the Fortnox
// customer cache (refreshed if stale). This is the living, Fortnox-synced view
// the Kunder page shows — each job keeps its own historical snapshot separately.
export async function listCachedCustomers(workshopId: string): Promise<FortnoxCustomerResult[]> {
  await ensureCustomersCacheFresh(workshopId);
  const { data, error } = await supabaseAdmin
    .from("fortnox_customers_cache")
    .select("*")
    .eq("workshop_id", workshopId)
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []).map(cacheRowToCustomer);
}

export async function searchCustomersFromCache(workshopId: string, query: string): Promise<FortnoxCustomerResult[]> {
  await ensureCustomersCacheFresh(workshopId);
  const [{ data, error }, { data: jobsData }] = await Promise.all([
    supabaseAdmin
      .from("fortnox_customers_cache")
      .select("*")
      .eq("workshop_id", workshopId)
      .order("updated_at", { ascending: false })
      .limit(5000),
    // Fetch personal names for customers registered under a company name
    supabaseAdmin
      .from("jobs")
      .select("fortnox_customer_number, customer_first_name, customer_last_name, customer_company_name")
      .eq("workshop_id", workshopId)
      .not("fortnox_customer_number", "is", null) as any,
  ]);
  if (error) throw new Error(error.message);

  // Build a map: fortnox_customer_number → personal first+last name
  // Only populated when the customer has a company name (meaning official name ≠ personal name)
  const personalNameMap = new Map<string, string>();
  for (const job of (jobsData ?? []) as any[]) {
    const num = job.fortnox_customer_number as string | null;
    if (!num || personalNameMap.has(num)) continue;
    const companyName = (job.customer_company_name as string | null)?.trim();
    if (!companyName) continue;
    const first = (job.customer_first_name as string | null)?.trim() ?? "";
    const last = (job.customer_last_name as string | null)?.trim() ?? "";
    const personal = [first, last].filter(Boolean).join(" ");
    if (personal) personalNameMap.set(num, personal);
  }

  const customers = (data ?? []).map((r) => {
    const c = cacheRowToCustomer(r);
    const personal = personalNameMap.get(c.customerNumber);
    if (personal) c.personalName = personal;
    return c;
  });

  const q = query.trim();
  // Empty query = "browse" → return the full list so the client can filter
  // locally without missing anyone. With a query, token-aware match + ranking.
  if (!q) return customers;
  return rankCustomers(customers, q, []);
}

function buildArticleSearchText(a: FortnoxArticleResult): string {
  return [a.articleNumber, a.description].filter(Boolean).join(" ").toLowerCase();
}

function articleToCacheRow(workshopId: string, a: FortnoxArticleResult, stamp: string) {
  return {
    workshop_id: workshopId,
    article_number: a.articleNumber,
    description: a.description ?? null,
    sales_price: a.salesPrice,
    unit: a.unit,
    vat: a.vat,
    search_text: buildArticleSearchText(a),
    updated_at: stamp,
  };
}

function cacheRowToArticle(r: any): FortnoxArticleResult {
  return {
    articleNumber: String(r.article_number ?? ""),
    description: r.description ?? "",
    salesPrice: r.sales_price != null ? Number(r.sales_price) : null,
    unit: r.unit ?? null,
    vat: r.vat != null ? Number(r.vat) : null,
  };
}

export async function upsertArticleCacheRow(workshopId: string, a: FortnoxArticleResult): Promise<void> {
  if (!a.articleNumber) return;
  const { error } = await supabaseAdmin
    .from("fortnox_articles_cache")
    .upsert(articleToCacheRow(workshopId, a, new Date().toISOString()), { onConflict: "workshop_id,article_number" });
  if (error) throw new Error(error.message);
}

// Pull the workshop's full article list from Fortnox, following pagination.
export async function fetchAllFortnoxArticles(userId: string): Promise<FortnoxArticleResult[]> {
  const out: FortnoxArticleResult[] = [];
  const seen = new Set<string>();
  const MAX_PAGES = 20;
  for (let page = 1; page <= MAX_PAGES; page++) {
    // Deliberately NOT caught here: swallowing this would make an auth
    // failure (dead/wedged connection) indistinguishable from "this workshop
    // genuinely has zero articles" — and syncFortnoxArticlesCache below wipes
    // the entire cache when it sees zero rows. That happened in production:
    // a wedged connection silently emptied a workshop's article cache and
    // marked it "freshly synced", so the search UI showed nothing with no
    // error at all. Let real errors propagate so the cache is left alone.
    const data = await fortnoxJson<{ Articles?: any[]; MetaInformation?: any }>(
      userId,
      `/articles?limit=500&page=${page}`,
    );
    const arr = data?.Articles ?? [];
    for (const a of arr) {
      const num = String(a?.ArticleNumber ?? "").trim();
      if (!num || seen.has(num)) continue;
      seen.add(num);
      out.push({
        articleNumber: num,
        description: String(a?.Description ?? ""),
        salesPrice: a?.SalesPrice != null ? Number(a.SalesPrice) : null,
        unit: a?.Unit ?? null,
        vat: a?.VAT != null ? Number(a.VAT) : null,
      });
    }
    const totalPages = Number(data?.MetaInformation?.["@TotalPages"] ?? 1);
    if (!arr.length || page >= totalPages) break;
  }
  return out;
}

export async function syncFortnoxArticlesCache(workshopId: string): Promise<void> {
  const all = await fetchAllFortnoxArticles(workshopId);
  const stamp = new Date().toISOString();
  const rows = all.filter((a) => a.articleNumber).map((a) => articleToCacheRow(workshopId, a, stamp));
  if (rows.length) {
    const { error } = await supabaseAdmin
      .from("fortnox_articles_cache")
      .upsert(rows, { onConflict: "workshop_id,article_number" });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("fortnox_articles_cache").delete().eq("workshop_id", workshopId).lt("updated_at", stamp);
  } else {
    await supabaseAdmin.from("fortnox_articles_cache").delete().eq("workshop_id", workshopId);
  }
  await setCacheSyncedAt(workshopId, "articles");
}

async function ensureArticlesCacheFresh(workshopId: string): Promise<void> {
  const syncedAt = await getCacheSyncedAt(workshopId, "articles");
  if (syncedAt != null && Date.now() - syncedAt < CACHE_MAX_AGE_MS) return;
  const key = `articles:${workshopId}`;
  let p = inflightCacheSync.get(key);
  if (!p) {
    const raw = syncFortnoxArticlesCache(workshopId).finally(() => inflightCacheSync.delete(key));
    // Background refresh (cache already existed): swallow errors silently.
    // First-ever sync (syncedAt == null): let the error propagate so the
    // caller can surface a meaningful message instead of returning empty.
    p = syncedAt != null ? raw.catch((e) => console.error("Fortnox article cache sync failed", e)) : raw;
    inflightCacheSync.set(key, p);
  }
  if (syncedAt == null) await p;
}

export async function searchArticlesFromCache(workshopId: string, query: string): Promise<FortnoxArticleResult[]> {
  await ensureArticlesCacheFresh(workshopId);
  const { data, error } = await supabaseAdmin
    .from("fortnox_articles_cache")
    .select("*")
    .eq("workshop_id", workshopId)
    .order("article_number", { ascending: true })
    .limit(10000);
  if (error) throw new Error(error.message);
  const q = query.trim().toLowerCase();
  const results: FortnoxArticleResult[] = [];
  for (const r of data ?? []) {
    const a = cacheRowToArticle(r);
    if (q && !a.articleNumber.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) continue;
    results.push(a);
    if (results.length >= 100) break;
  }
  return results;
}

export type FortnoxArticleLine = {
  article_number?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  vat?: number | null;
};

// Read a single linked customer straight from Sipomax's local cache (which is
// kept in sync with the Fortnox customer). Used at invoice-build time so the
// invoice always reflects the *saved* customer, not a drifted per-job copy.
async function getCachedCustomerByNumber(workshopId: string, customerNumber: string): Promise<FortnoxCustomerResult | null> {
  const { data } = await supabaseAdmin
    .from("fortnox_customers_cache")
    .select("*")
    .eq("workshop_id", workshopId)
    .eq("customer_number", customerNumber)
    .maybeSingle();
  return data ? cacheRowToCustomer(data) : null;
}

// Live fallback when the cache hasn't got the customer yet (e.g. just created).
async function fetchFortnoxCustomerByNumber(userId: string, customerNumber: string): Promise<FortnoxCustomerResult | null> {
  const res = await fortnoxFetch(userId, `/customers/${encodeURIComponent(customerNumber)}`, { method: "GET" });
  if (!res.ok) return null;
  const c = (await res.json().catch(() => null) as any)?.Customer;
  if (!c) return null;
  return {
    customerNumber: String(c.CustomerNumber ?? customerNumber),
    name: c.Name ?? "",
    email: c.Email || undefined,
    phone: c.Phone1 || c.Phone || c.Telephone1 || undefined,
    orgNumber: c.OrganisationNumber || undefined,
    address: c.Address1 || undefined,
    zipCode: c.ZipCode || undefined,
    city: c.City || undefined,
  };
}

// The customer of record for an invoice: the saved (Fortnox-synced) customer
// identified by the job's/override's customer number. Cache first, live fallback.
export async function resolveLinkedCustomer(userId: string, customerNumber: string): Promise<FortnoxCustomerResult | null> {
  const num = (customerNumber || "").trim();
  if (!num) return null;
  return (await getCachedCustomerByNumber(userId, num)) ?? (await fetchFortnoxCustomerByNumber(userId, num));
}

async function buildFortnoxInvoiceBodyFromArticles(
  userId: string,
  job: any,
  articles: FortnoxArticleLine[],
  overrides: ArticleInvoiceOverrides = {},
) {
  const rows: any[] = [];

  for (const line of articles) {
    const row: Record<string, any> = {
      Description: sanitizeFortnoxText(line.description || "Artikel", 50),
      DeliveredQuantity: String(line.quantity ?? 1),
      // Always send Price so the per-job temporary price overrides the article master.
      Price: Number(line.unit_price ?? 0),
      VAT: line.vat != null ? Number(line.vat) : 25,
    };
    const articleNumber = (line.article_number ?? "").toString().trim();
    if (articleNumber) row.ArticleNumber = articleNumber;
    rows.push(row);
  }

  // Fallback customer details (only used when the job has no linked customer).
  const fallbackName = overrides.customerName || job.customer_name || "Kund";
  const fallbackAddress = overrides.address ?? (job.billing_address || undefined);
  const fallbackZip = overrides.zipCode ?? (job.billing_postal_code ? String(job.billing_postal_code) : undefined);
  const fallbackCity = overrides.city ?? (job.billing_city || undefined);

  // Ensure the token is refreshed once before firing parallel requests.
  // Without this, both concurrent calls see an expired token and race to
  // refresh it — Fortnox rotates it on first use, so the loser gets invalid_grant.
  await warmFortnoxToken(userId);

  const linkedNumber = (overrides.customerNumber?.trim() || (job.fortnox_customer_number || "").trim());
  const [resolvedCustomerNumber, printTemplate] = await Promise.all([
    linkedNumber
      ? Promise.resolve(linkedNumber)
      : findOrCreateFortnoxCustomer(userId, {
          name: sanitizeFortnoxText(fallbackName, 1024),
          email: job.customer_email || undefined,
          address: fallbackAddress ? sanitizeFortnoxText(fallbackAddress, 1024) : undefined,
          zipCode: fallbackZip || undefined,
          city: fallbackCity ? sanitizeFortnoxText(fallbackCity, 1024) : undefined,
        }),
    getFortnoxDefaultPrintTemplate(userId),
  ]);

  // Pull the invoice's customer identity/address straight from the saved
  // (Fortnox-synced) customer record so it always matches what "Redigera kund"
  // last saved — never a drifted per-job copy. Only fall back to job/override
  // values when there's genuinely no customer record to read.
  const linkedCustomer = resolvedCustomerNumber ? await resolveLinkedCustomer(userId, resolvedCustomerNumber) : null;
  const custName = linkedCustomer?.name || fallbackName;
  const custAddress = linkedCustomer?.address ?? fallbackAddress;
  const custZip = linkedCustomer?.zipCode ?? fallbackZip;
  const custCity = linkedCustomer?.city ?? fallbackCity;
  const custEmail = linkedCustomer?.email ?? (job.customer_email || undefined);

  // NOTE: we deliberately do NOT push the job's customer fields back onto the
  // Fortnox customer card here. Invoicing must not silently rename/overwrite a
  // customer's master record — that only happens on the explicit "Spara
  // kunduppgifter" action (updateFortnoxCustomerDirect).

  const today = new Date().toISOString().slice(0, 10);
  const invoice: Record<string, any> = {
    CustomerNumber: resolvedCustomerNumber,
    CustomerName: sanitizeFortnoxText(custName, 1024),
    ...(custAddress ? { Address1: sanitizeFortnoxText(custAddress, 1024) } : {}),
    ...(custZip ? { ZipCode: String(custZip).replace(/[^0-9 ]/g, "").trim() } : {}),
    ...(custCity ? { City: sanitizeFortnoxText(custCity, 1024) } : {}),
    ...(printTemplate ? { PrintTemplate: printTemplate } : {}),
    ...(custEmail ? { EmailInformation: { EmailAddressTo: custEmail.trim() } } : {}),
    InvoiceDate: overrides.invoiceDate || today,
    ...(overrides.dueDate ? { DueDate: overrides.dueDate } : {}),
    ...(overrides.paymentTerms ? { TermsOfPayment: overrides.paymentTerms } : {}),
    Currency: "SEK",
    InvoiceRows: rows,
    YourReference: sanitizeFortnoxText(overrides.yourReference ?? (job.customer_name || ""), 50),
    OurReference: sanitizeFortnoxText(overrides.ourReference ?? job.registration_number ?? "", 50),
  };

  return { Invoice: invoice };
}

// Create (or update the existing draft) for a job from the given article lines.
// Returns the Fortnox document number and the Invoice JSON Fortnox echoed back.
// This is the ONLY article-flow path that creates an invoice in Fortnox — it is
// called when the user books or sends, never during "Förhandsgranska".
export async function ensureFortnoxInvoiceFromArticles(
  userId: string,
  jobId: string,
  articles: FortnoxArticleLine[],
  overrides: ArticleInvoiceOverrides = {},
) {
  // Scope by workshop so another workshop's job can never be invoiced/repointed
  // through this path. `userId` here is the resolved workshop id.
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("workshop_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Jobbet hittades inte.");

  const invoiceBody = await buildFortnoxInvoiceBodyFromArticles(userId, job, articles, overrides);
  const existingId = (job.fortnox_invoice_id || "").trim();

  if (existingId) {
    const existing = await getFortnoxInvoice(userId, existingId);
    // Only reuse drafts that haven't been booked or cancelled yet.
    if (existing && !asBool(existing.Booked) && !asBool(existing.Cancelled)) {
      const id = encodeURIComponent(existingId);
      const path = `/invoices/${id}`;
      const res = await fortnoxFetch(userId, path, { method: "PUT", body: JSON.stringify(invoiceBody) });
      const text = await res.text();
      if (res.ok) {
        await saveInvoiceIdForJob(jobId, existingId, userId);
        return { invoiceId: existingId, invoice: text ? JSON.parse(text)?.Invoice ?? null : null };
      }
      if (res.status !== 404) throw new Error(fortnoxErrorMessage(path, res.status, text));
    }
  }

  const created = await fortnoxJson<{ Invoice?: any }>(userId, "/invoices", {
    method: "POST",
    body: JSON.stringify(invoiceBody),
  });
  const documentNumber = created.Invoice?.DocumentNumber;
  if (documentNumber == null) throw new Error("Fortnox returnerade inget fakturanummer.");
  await saveInvoiceIdForJob(jobId, String(documentNumber), userId);
  return { invoiceId: String(documentNumber), invoice: created.Invoice ?? null };
}

// "Förhandsgranska faktura": build a local draft of exactly how the invoice will
// look, WITHOUT creating anything in Fortnox. The Fortnox invoice number and OCR
// only come into existence when the user books or sends, so those fields are
// left empty here (DocumentNumber/OCR = ""). Totals are computed locally from the
// article lines so the amounts match what Fortnox will produce.
export async function buildLocalFortnoxInvoicePreview(
  userId: string,
  job: any,
  articles: FortnoxArticleLine[],
  overrides: ArticleInvoiceOverrides = {},
) {
  const rows = articles.map((line) => {
    const quantity = Number(line.quantity ?? 1);
    const price = Number(line.unit_price ?? 0);
    const vat = line.vat != null ? Number(line.vat) : 25;
    const articleNumber = (line.article_number ?? "").toString().trim();
    return {
      ArticleNumber: articleNumber || null,
      Description: sanitizeFortnoxText(line.description || "Artikel", 50),
      DeliveredQuantity: String(quantity),
      Price: price,
      VAT: vat,
      Sum: quantity * price,
    };
  });

  const net = rows.reduce((acc, r) => acc + r.Sum, 0);
  const totalVat = rows.reduce((acc, r) => acc + r.Sum * (Number(r.VAT) / 100), 0);
  const total = net + totalVat;

  // Pull the customer identity/address from the saved (Fortnox-synced) customer
  // record so the preview matches exactly what will be invoiced. Fall back to
  // the job/override values only when there's no linked customer.
  const linkedNumber = (overrides.customerNumber?.trim() || (job.fortnox_customer_number || "").trim());
  const linkedCustomer = linkedNumber ? await resolveLinkedCustomer(userId, linkedNumber) : null;
  const custName = linkedCustomer?.name || overrides.customerName || job.customer_name || "Kund";
  const custAddress = linkedCustomer?.address ?? overrides.address ?? (job.billing_address || undefined);
  const custZip = linkedCustomer?.zipCode ?? overrides.zipCode ?? (job.billing_postal_code ? String(job.billing_postal_code) : undefined);
  const custCity = linkedCustomer?.city ?? overrides.city ?? (job.billing_city || undefined);
  const custEmail = linkedCustomer?.email ?? (job.customer_email || undefined);
  const today = new Date().toISOString().slice(0, 10);

  return {
    // Empty until an actual Fortnox invoice is created on book/send.
    DocumentNumber: "",
    OCR: "",
    CustomerNumber: linkedNumber || null,
    CustomerName: sanitizeFortnoxText(custName, 1024),
    Address1: custAddress ? sanitizeFortnoxText(custAddress, 1024) : null,
    ZipCode: custZip ? String(custZip).replace(/[^0-9 ]/g, "").trim() : null,
    City: custCity ? sanitizeFortnoxText(custCity, 1024) : null,
    Country: null,
    InvoiceDate: overrides.invoiceDate || today,
    DueDate: overrides.dueDate ?? null,
    TermsOfPayment: overrides.paymentTerms ?? null,
    Currency: "SEK",
    InvoiceRows: rows,
    YourReference: sanitizeFortnoxText(overrides.yourReference ?? (job.customer_name || ""), 50),
    OurReference: sanitizeFortnoxText(overrides.ourReference ?? job.registration_number ?? "", 50),
    ...(custEmail ? { EmailInformation: { EmailAddressTo: custEmail.trim() } } : {}),
    Net: net,
    VAT: totalVat,
    TotalVAT: totalVat,
    Total: total,
  };
}

async function bookkeepFortnoxInvoice(userId: string, documentNumber: string): Promise<void> {
  const id = encodeURIComponent(documentNumber);
  const path = `/invoices/${id}/bookkeep`;
  const res = await fortnoxFetch(userId, path, { method: "PUT" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(fortnoxErrorMessage(path, res.status, text));
  }
}

export async function bookkeepFortnoxInvoiceForJob(userId: string, documentNumber: string): Promise<void> {
  await bookkeepFortnoxInvoice(userId, documentNumber);
}

export interface FortnoxCompanyInfo {
  companyName: string;
  address: string | null;
  zipCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  organisationNumber: string | null;
  vatNumber: string | null;
}

export async function getFortnoxCompanyInfo(userId: string): Promise<FortnoxCompanyInfo> {
  const res = await fortnoxFetch(userId, "/companyinformation", { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(fortnoxErrorMessage("/companyinformation", res.status, text));
  const d = JSON.parse(text)?.CompanyInformation ?? {};
  return {
    companyName: d.CompanyName ?? "",
    address: d.Address ?? null,
    zipCode: d.ZipCode ?? null,
    city: d.City ?? null,
    phone: d.Phone ?? null,
    email: d.Email ?? null,
    organisationNumber: d.OrganisationNumber ?? null,
    vatNumber: d.VATNumber ?? null,
  };
}

// Email the invoice to the customer (Fortnox "email" action is a GET that also
// sends per the invoice's EmailInformation).
export async function emailFortnoxInvoice(userId: string, documentNumber: string): Promise<void> {
  const id = encodeURIComponent(documentNumber);
  const path = `/invoices/${id}/email`;
  const res = await fortnoxFetch(userId, path, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(fortnoxErrorMessage(path, res.status, text));
  }
}

// Mark the invoice as sent in Fortnox without Fortnox itself emailing the
// customer. Sipomax already delivers the invoice to the customer (SMS + PDF),
// so we use the "externalprint" action, which flags the invoice as Sent in
// Fortnox (so it stops showing as an untouched draft) but suppresses Fortnox's
// own email/print. This keeps Fortnox's view of the invoice in step with what
// the customer actually received, without double-notifying them.
export async function markFortnoxInvoiceSent(userId: string, documentNumber: string): Promise<void> {
  const id = encodeURIComponent(documentNumber);
  const path = `/invoices/${id}/externalprint`;
  const res = await fortnoxFetch(userId, path, { method: "PUT" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(fortnoxErrorMessage(path, res.status, text));
  }
}
