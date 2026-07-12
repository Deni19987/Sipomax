# Agent Runbook — Sipomax / Vehicle Hub Chat

Operational knowledge base for AI agents working on this repo. Read this when
starting any task that touches auth, testing, Fortnox, Supabase, or the SPA
routing layer. It captures bugs already debugged and quirks already discovered
so you don't repeat the same investigation.

---

## 1. Credentials & Environment

| Thing | Value |
|---|---|
| Production URL | `https://sipomax.se` |
| Supabase project | `https://YOUR_PROJECT_REF.supabase.co` |
| Admin account | `hedisson@live.se` / see password manager (not stored in repo) |
| Fortnox account | `hedisson@live.se` (same user, connected via OAuth) |
| Dev branch (current) | `claude/dazzling-hypatia-y1dtrd` |
| Open PR | #23 — push to this branch to update it |

The Supabase anon/publishable key is baked into the Vite build at compile time
(`VITE_SUPABASE_PUBLISHABLE_KEY`). It is NOT in any `.env` file in the repo —
it lives in the Netlify/Lovable environment. You cannot read it from disk.
The service role key (`SUPABASE_SERVICE_ROLE_KEY`) is also only available at
runtime; never log it or return it in responses.

---

## 2. Playwright / E2E Testing

### Always capture errors when running tests

When a test fails or a feature appears broken, **always add error listeners
before diagnosing**. Silent failures (no toast, no API error visible) are
common because the Playwright response listener only fires on HTTP responses —
a hanging request produces no output at all. A feature can appear broken while
the real error is a Fortnox/Visma API rejection that only shows in the UI toast.

Add these listeners at the top of every test that exercises API calls:

```ts
const apiErrors: string[] = [];
const consoleLogs: string[] = [];

page.on("response", async (response) => {
  if (!response.ok() && response.url().includes("sipomax.se")) {
    const body = await response.text().catch(() => "");
    apiErrors.push(`${response.status()} ${response.url()} — ${body.slice(0, 200)}`);
  }
});
page.on("console", (msg) => {
  if (msg.type() === "error") consoleLogs.push(`[console.error] ${msg.text()}`);
});
page.on("pageerror", (err) => consoleLogs.push(`[pageerror] ${err.message}`));
```

And always log them at the end (even on success):
```ts
console.log("API errors:", apiErrors);
console.log("Console errors:", consoleLogs);
```

**If a request hangs with no errors at all** — check the server-side code for
calls to external APIs (Fortnox, Visma) that have no timeout set. The
Cloudflare Worker will wait indefinitely for outbound `fetch()` calls.
Reproduce manually in the browser to get the actual error toast, which
often reveals the root cause faster than increasing test timeouts.

### TanStack Router SPA navigation does NOT fire `waitForNavigation`

**The problem:** After clicking "Logga in", TanStack Router calls
`navigate({ to: "/dashboard" })` which uses `history.pushState`. Playwright's
`waitForNavigation()` only fires on full-page HTTP navigations, not pushState.
The result: `waitForNavigation` resolves immediately (before auth finishes) or
times out, and checks run against the still-visible login form.

**The fix:** After a form submit that triggers SPA navigation, do NOT use
`waitForNavigation`. Instead:
```ts
await page.click('button[type="submit"]');
// Wait for network (Supabase auth request) + SPA re-render
await page.waitForLoadState("networkidle", { timeout: 30000 });
// Then check the URL or for an element that only exists post-login
await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
```
Or use `page.waitForFunction(() => window.location.pathname.includes('/dashboard'))`.

### Existing `app.spec.ts` login test was already broken

`tests/e2e/app.spec.ts` line 48 — the "login with valid credentials" test
also fails with the same SPA navigation issue. Not a regression from any recent
change; it was never working in CI from this container.

### Credentials in test files were stale

`app.spec.ts` originally had a stale hardcoded password that no longer
matched the account. Test credentials are no longer hardcoded anywhere in the
repo — see `tests/e2e/test-credentials.ts`, which reads `PW_ADMIN_EMAIL` /
`PW_ADMIN_PASSWORD` from the environment. Set those in a local (gitignored)
`.env.test` or as CI secrets before running the e2e suite.

### Playwright browser install is required after npm install

After `npm install --save-dev @playwright/test`, you must also run
`npx playwright install chromium`. The browser binary is stored separately at
`/opt/pw-browsers/` and is not installed by `npm install` alone.

### `@playwright/test` must be installed separately

The project's `playwright` config imports from `@playwright/test`, not the bare
`playwright` package. If you see `ERR_MODULE_NOT_FOUND` for `@playwright/test`,
run `npm install --save-dev @playwright/test`.

### Test auth via API, not UI form, when possible

UI login is flaky because of SPA navigation. For tests that just need an
authenticated page, it is faster and more reliable to:
1. Call Supabase's REST auth endpoint directly to get a session token
2. Set it in localStorage via `page.evaluate` before navigating
3. Navigate to the protected URL directly

```ts
import { requireTestCredentials } from './test-credentials';
const { email, password } = requireTestCredentials();
const res = await fetch('https://YOUR_PROJECT_REF.supabase.co/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
  body: JSON.stringify({ email, password }),
});
const { access_token, refresh_token } = await res.json();
// Then in page.evaluate: set localStorage key 'sb-YOUR_PROJECT_REF-auth-token'
```

---

## 3. Supabase Client Quirks

### The browser client is a lazy Proxy

`src/integrations/supabase/client.ts` exports `supabase` as a `Proxy` that
defers `createClient()` until the first property access. This means:
- **Importing** `supabase` does NOT initialize the client.
- The client only initializes when you first call `supabase.auth.*`,
  `supabase.from(...)`, etc.
- This matters for invite link handling — see section 4.

### Supabase clears the URL hash after processing invite tokens

When the Supabase client initialises and detects `#access_token=...&type=invite`
in the URL, it processes the token and then calls `history.replaceState` to
strip the hash. This happens inside the first `supabase.auth.*` call.

**Consequence:** If you try to read `window.location.hash` in a `useRef`
initializer inside the component, and any code elsewhere has already called
`supabase.auth.getSession()` (e.g. in a provider, hook, or another component
rendered first), the hash will already be gone and the invite will not be
detected.

**Fix:** Capture invite state at **module level**, before the component
function, and before any `supabase.auth.*` call:
```ts
// Top of login.tsx, BEFORE the component function
const _hash = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.hash.replace(/^#/, ''))
  : new URLSearchParams();
const _capturedIsInvite = _hash.get('type') === 'invite';
const _capturedAccessToken = _hash.get('access_token') ?? null;
const _capturedRefreshToken = _hash.get('refresh_token') ?? null;
```

### `useRef` initializers run server-side and are NOT re-run on hydration

Even with `ssr: false` on a route, modules are still imported on the server for
route matching. If a `useRef` initializer reads `window.location.hash`, it
returns `false` on the server side (where `window` is undefined) and React
keeps that value on client hydration — it does NOT re-run the initializer.

This is why the original invite flow used `useRef` to capture the hash inside
the component, but that is unreliable. Module-level capture (before the
component) runs only on the client and is correct.

### Invite tokens are one-time use

Once Supabase exchanges an invite `access_token` for a session — even if it
doesn't create a new session because the user was already logged in — the token
may be consumed. Reopening the same invite link after the first visit may fail.

### Re-inviting after delete can hit "already registered"

`supabase.auth.admin.inviteUserByEmail()` can return "User already registered"
immediately after `deleteUser()` due to Supabase eventual consistency. The
workaround (already implemented in `users.server.ts`): catch that error, look
up the user by email, delete them again, then retry the invite once.

### `supabase.auth.setSession()` can establish an invite session

If you have the raw `access_token` and `refresh_token` from the invite URL
hash, you can call `supabase.auth.setSession({ access_token, refresh_token })`
to establish the invited user's session directly. This works even if the Supabase
client hasn't auto-processed the hash (e.g. because admin was already signed in
and Supabase skipped the hash processing).

---

## 4. TanStack Router / Start Quirks

### `navigate()` is client-side only; don't call it in SSR context

`useNavigate()` from TanStack Router calls `history.pushState`. Calling it
during SSR (server render) throws. Always guard with `typeof window !== 'undefined'`
or put the route under `ssr: false`.

### Route loaders that call `requireSupabaseAuth` server fns break SSR

If a route under `/_authenticated/` calls a protected server fn in its `loader`,
the SSR prerender will fail with 401 because there is no session on the server.
Call protected server fns from `useQuery` inside the component instead, not
from the loader.

### `src/routeTree.gen.ts` is auto-generated — never edit it

TanStack Router generates the route tree from the file names in `src/routes/`.
Editing `routeTree.gen.ts` manually will be overwritten and may corrupt routing.

### `jobs.$id.tsx` only calls `<Outlet />` for the update-detail child route

**The problem:** `src/routes/_authenticated/jobs.$id.tsx` line 144 has:
```ts
if (isUpdateDetailRoute) return <Outlet />;
```
This means the parent only renders child routes when viewing the update-detail
sub-route. Any other child route file (e.g. `jobs.$id.invoice.tsx`) that exists
under `/jobs/:id/` will be matched by the router but the parent will NOT call
`<Outlet />` for it — the child route UI never renders.

**The fix (already applied):** Instead of linking to the `/jobs/$id/invoice`
child route, link to the parent route with the `#invoice` hash which opens the
Fakturering tab:
```ts
// WRONG — child route never renders:
<Link to="/jobs/$id/invoice" params={{ id: jobId }}>Fyll i & generera faktura</Link>
// CORRECT — opens Fakturering tab via hash:
<Link to="/jobs/$id" params={{ id: jobId }} hash="invoice">Fyll i & generera faktura</Link>
```

**Real invoice UI location:** The invoice form (InvoiceTab component) lives
inside `jobs.$id.tsx` and is rendered when `activeTab === "invoice"`. The active
tab is initialized from `window.location.hash`. Navigate to `/jobs/:id#invoice`
to open it directly. The "Förhandsgranska PDF" button (type="button") calls
`generateInvoicePreviewPdf` and opens a dialog with "Förhandsgranskning av
faktura" as the title when the PDF loads.

---

## 5. Fortnox Integration

### No sandbox — all calls go to production

Fortnox has no test/sandbox environment. Every API call hits
`https://api.fortnox.se/3` with real data. The connected account
(`hedisson@live.se`) is the actual developer test account.

### Scopes requested: `invoice customer article`

`FORTNOX_SCOPES = "invoice customer article"` in `fortnox.server.ts`:
- `invoice` — create/read/update invoices and fetch PDF previews
- `customer` — required because Fortnox needs a valid `CustomerNumber` on every invoice; `findOrCreateFortnoxCustomer()` searches by email and creates if not found
- `article` — read/create article records for invoice row lookups

If the scope list changes, the user must disconnect and reconnect Fortnox in Settings to grant the new scopes.

### Fortnox Invoice field names — writable vs read-only

When embedding customer details directly on an invoice (without using a
`CustomerNumber` / avoiding the `customer` scope), these are the rules:

**Writable fields on Invoice (POST/PUT):**

| What | Field name | Notes |
|---|---|---|
| Customer | `CustomerNumber` | Required; looked up or created via `/customers` |
| Email (override) | `EmailInformation: { EmailAddressTo }` | nested sub-object, NOT top-level |
| Invoice date | `InvoiceDate` | YYYY-MM-DD |
| Due date | `DueDate` | YYYY-MM-DD |
| Currency | `Currency` | 3-char code e.g. "SEK" |
| Line items | `InvoiceRows` | array, see below |
| Customer ref | `YourReference` | max 50 chars |
| Our ref | `OurReference` | max 50 chars |
| Order ref | `ExternalInvoiceReference1` | max 50 chars |
| Free text | `Remarks` | shown on invoice |
| Credit invoice | `Credit` | boolean |

**Read-only fields (do NOT include in POST/PUT body):**

| Field | Why |
|---|---|
| `OrganisationNumber` | Sourced from the linked customer record — not in payload schema |
| `DocumentNumber` | Auto-assigned by Fortnox |
| `Balance`, `Gross`, `Net`, `Tax` | Calculated |
| `Booked`, `Cancelled`, `Sent` | Status flags |
| `Credit` | Read-only flag — NOT in `InvoiceSinglePayloadItem`; credit invoices are created via `POST /invoices/{id}/credit` action on an already-booked invoice |

**InvoiceRow writable fields:** `Description` (max 50), `DeliveredQuantity`,
`Price`, `VAT` (integer: 0/6/12/25), `Unit`, `ArticleNumber` (optional),
`AccountNumber`, `Discount`, `DiscountType` (PERCENT or AMOUNT).

### Invoice rows do NOT use ArticleNumber

Line items are sent without `ArticleNumber`. VAT and price are set directly on
each row. This avoids needing the Artikel (Article) module license.

### The Faktura module must be activated on the Fortnox account

Even with the `invoice` OAuth scope, the connected Fortnox account needs the
**Faktura** (Invoice) module enabled. For a developer test account this should
be free, but it must be manually activated in the Fortnox portal. As of this
session the user has activated Faktura + Offerter/Ordrar on the account.

### Fortnox error format

Errors come back as `{ ErrorInformation: { message, code } }`. The
`fortnoxErrorMessage()` helper in `fortnox.server.ts` parses this and formats
it for display. If you see a raw JSON blob in an error toast, that helper may
not be catching the error — check that the `Content-Type` is `application/json`.

### Token refresh on 401

`fortnoxFetch()` automatically retries once on 401 by refreshing the access
token from the stored refresh token. If you see repeated 401s in logs, the
refresh token itself may be expired or revoked — the user needs to reconnect
Fortnox from Settings.

---

## 6. Cloudflare Workers Runtime Constraints

The app runs on Cloudflare Workers (see `wrangler.jsonc`). Things that do NOT
work in this runtime:
- `fs`, `path`, `child_process`, `crypto` (Node built-ins) — use the Web Crypto
  API instead (`globalThis.crypto`) or the `node:crypto` compat layer
- `puppeteer`, `sharp`, `canvas` — native bindings don't run in Workers
- Long-running background tasks — Workers have a CPU time limit; offload to
  Supabase Edge Functions or external queues if needed

`nodejs_compat` flag is enabled (`wrangler.jsonc`), which polyfills some Node
APIs including `crypto` via `import { createHmac } from 'crypto'`.

---

## 7. Styling

Tailwind v4 is configured via `src/styles.css` — there is no `tailwind.config.js`.
Design tokens (`bg-background`, `text-foreground`, `text-muted-foreground`,
`border-input`, etc.) are defined as CSS custom properties in `styles.css`.
Do NOT use raw hex colors or `bg-white` / `text-black`.

---

## 8. Known Broken Tests

| Test | File | Issue | Status |
|---|---|---|---|
| "login with valid credentials redirects to dashboard" | `tests/e2e/app.spec.ts:29` | Fixed: was using `waitForNavigation` (doesn't fire for SPA pushState) + a stale hardcoded password | Fixed |
| Fortnox invoice preview | `tests/e2e/fortnox-invoice.spec.ts` | Fixed: was navigating to broken `/jobs/:id/invoice` child route; now uses `#invoice` hash → Fakturering tab | Fixed |

---

## 9. Deployment

- **Netlify** builds the project (`npm run build` → `dist/`) — see `netlify.toml`.
- **Cloudflare Workers** serves it via `wrangler.jsonc`.
- Pushes to `main` trigger production deploys. Feature branches do NOT
  auto-deploy to production.
- Our current feature branch (`claude/dazzling-hypatia-y1dtrd`) is NOT live on
  `sipomax.se` — the live site runs whatever is on `main`.

---

## 10. Quick Diagnosis Checklist

When something is broken and you don't know why, check these in order:

1. **Is it a TypeScript error?** Run `npx tsc --noEmit` (the `vite/client` error is pre-existing and harmless).
2. **Is it a server fn returning 401?** The route is probably not under `_authenticated/` or the middleware is missing.
3. **Is it a blank page after login?** Check that `_authenticated.tsx` renders `<Outlet />`.
4. **Is it a Supabase RLS error?** Check that the table has a policy for the `workshop` role and that you're using the right client (`supabaseAdmin` vs `supabase`).
5. **Is it a Fortnox 403/402?** The connected Fortnox account may lack a module license. Check the Fortnox portal.
6. **Is it an invite link that does nothing?** The URL hash was probably cleared before `isInviteRef` was set. See section 3.
7. **Is a Playwright test stuck on the login page?** SPA navigation — see section 2. Also verify `PW_ADMIN_EMAIL` / `PW_ADMIN_PASSWORD` are set correctly (see `tests/e2e/test-credentials.ts`).
