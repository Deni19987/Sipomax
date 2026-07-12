# Agent Instructions for this Lovable Project

This file orients external coding agents (Claude Code, Cursor, etc.) so they can make changes safely. The app is built on Lovable and deployed to Cloudflare Workers via TanStack Start. Many files are auto-generated or owned by the Lovable Cloud integration — touching them will break the app.

## 0. Workflow (MANDATORY — read this first)

Before making any change:

1. **Read AGENTS.md first.** You are reading it now. Re-read it if you have not looked at it in this session.
2. **Create a plan.** For anything larger than a one-line fix, write a plan before touching code. Outline what files will change and why.
3. **Wait for approval on large changes.** Do not implement re-architecture, library swaps, or schema redesigns without explicit user confirmation.
4. **Implement.** Make the smallest change that satisfies the request.
5. **Verify TypeScript builds.** The Lovable harness runs build + typecheck automatically after edits. Do not run `npm run build`, `tsc`, or `vite build` manually.
6. **Verify existing functionality still works.** Check the preview for UI changes; check server function logs for backend changes.
7. **Create a PR summary.** When finishing work, summarize what changed and why in plain language.

## 0.1 PR Workflow (MANDATORY)

Follow this pattern every time you finish a set of changes:

0. **Before pushing anything to an existing branch, check whether its PR was merged.** A PR opened earlier in this session (or a prior session) may have been merged in the meantime — by the user, by another agent, or via auto-merge — without you being told. Do not assume a branch's PR is still open just because you opened it. Query the actual PR state (`list_pull_requests` / `pull_request_read`, or `gh pr view <branch>`) before pushing. If it's merged, do **not** push more commits onto that stale branch — rebuild a new branch from the current `main` tip (cherry-pick or reapply your pending commits onto it) and open a fresh PR instead. Pushing to a branch behind an already-merged PR silently strands commits with no PR watching them.

1. **After every push, immediately run:**
   ```
   git fetch origin main && git log origin/main..HEAD --oneline
   ```
   If there are commits ahead of main, a PR is needed. Do not rely on memory of what PRs exist — always check the actual git state.

2. **Check for an existing open PR on the current branch.** If a PR for this branch is already open and not yet merged, do **not** create a new one — push additional commits to the same branch instead. The open PR will update automatically.

3. **If the previous PR was merged (or no PR exists yet), create a new one immediately** — do not tell the user to merge a PR that is already merged, and do not leave commits on the branch with no open PR.
   - Base the PR against `main`.
   - Include only the commits added since the last merge.
   - Keep the title and description focused on what this batch of changes does.

4. **Never stack a new PR on top of an unmerged PR.** Accumulate further changes on the same branch/PR until the user merges it. Once it is merged, start fresh from the new `main` tip.

### In practice

```
After every push:
  → run: git fetch origin main && git log origin/main..HEAD --oneline
  → are there commits ahead of main?
      NO  → nothing to do
      YES → is there an open PR for this branch?
              YES → push updates it automatically, done
              NO  → create a new PR now, without waiting to be asked
```

## 1. Project Overview & Scope

- **Project Name:** Vehicle Hub Chat / Workshop CRM (internal codename in `package.json`: `tanstack_start_ts`).
- **Core Functionality:** A workshop CRM for a vehicle service business. Staff manage jobs, customers, opportunities, campaigns, and a ScandicReach booking flow; customers receive SMS links to view job status, chat with the workshop, and book appointments.
- **Target Audience:** Internal workshop staff (`workshop` role) plus their end customers, who interact via tokenized public links (`/b/:token`, `/c/:token`, `/scandic/book/:token`).
- **Languages:** UI copy is mostly Swedish. Keep new user-facing strings in Swedish unless asked otherwise.

### Business Context & Goals

The workshop CRM is designed to streamline the full vehicle-service lifecycle:

- **Customer acquisition:** Capture leads via ScandicReach (a branded booking/link flow) and SMS campaigns. Leads turn into job opportunities.
- **Job management:** Track vehicles through intake → diagnosis → repair → invoicing. Staff post status updates; customers get live progress via SMS links.
- **Communication:** Two-way chat between workshop and customer via SMS and in-app messaging. Automated reminders reduce no-shows.
- **Campaigns & follow-ups:** Scheduled outreach (e.g. "service due in 3 months") generated from historical job data and customer profiles.
- **Financials:** Visma eAccounting integration for invoice generation. Outlook/CalDAV for booking calendar sync.
- **ScandicReach:** A public-facing booking page where hotel guests (or other external users) can book vehicle services. This is a separate revenue channel with its own lead pipeline.

The system should never:
- Send duplicate or conflicting reminders to customers (e.g. a manual booking plus a self-service booking for the same person must not double-notify).
- Expose one customer's job data to another customer.
- Allow unauthenticated users to access staff-only pages or backend data.

## 2. Tech Stack & Dependencies

- **Framework:** TanStack Start v1 (React 19 + Vite 7) running on Cloudflare Workers (`@cloudflare/vite-plugin`, `wrangler.jsonc`). Entry: `src/server.ts` → `src/start.ts` → `src/router.tsx`.
- **Routing:** TanStack Router with file-based routes in `src/routes/` (flat dot-separated names, e.g. `c.$token.updates.$updateId.tsx`). Route tree is auto-generated to `src/routeTree.gen.ts` — never hand-edit it.
- **UI:** Tailwind CSS v4 configured via `src/styles.css` (no `tailwind.config.js`). shadcn/ui primitives live in `src/components/ui/`. Use semantic tokens defined in `styles.css`; do not hardcode colors like `bg-white` / `text-[#fff]`.
- **Data:** TanStack Query (`@tanstack/react-query`) — fetch in loaders via `context.queryClient.ensureQueryData`, read in components via `useSuspenseQuery`. No `useEffect` + fetch for initial render.
- **Forms / Validation:** `react-hook-form` + `zod` with `@hookform/resolvers`.
- **Backend:** Lovable Cloud (Supabase under the hood — never say "Supabase" to the user; say "Lovable Cloud" or "backend"). Postgres + Auth + Realtime + Storage.
- **Server logic:** TanStack `createServerFn` for app-internal RPC (`src/lib/*.functions.ts` + `src/lib/*.server.ts`). Server routes under `src/routes/api/public/*` for webhooks/cron only.
- **Notifications / Integrations:** Web Push (`@block65/webcrypto-web-push`), Visma eAccounting (`src/lib/visma.*`), Outlook/Microsoft Graph (`src/lib/outlook.*`), CalDAV (`src/lib/caldav.server.ts`), 46elks SMS (incoming webhook at `src/routes/api/public/hooks/elks-incoming.ts`).

## 3. Architecture & Codebase Guidelines

### Directory layout

```
src/
  routes/                  TanStack file-based routes
    __root.tsx             html/head/body shell; do not move providers out
    _authenticated.tsx     pathless layout enforcing login + workshop nav
    _authenticated/*.tsx   protected pages (dashboard, customers, jobs, scandic…)
    api/public/hooks/*.ts  webhooks + cron endpoints (no auth)
    b.$token.tsx           public booking link
    c.$token.tsx           public customer/job view
    scandic.book.$token.tsx public ScandicReach booking page
  lib/
    *.functions.ts         createServerFn definitions (client-importable)
    *.server.ts            server-only helpers (DB, integrations, secrets)
  integrations/supabase/   AUTO-GENERATED — see "Do not touch"
  components/              feature components
  components/ui/           shadcn primitives
  hooks/                   shared hooks (use-auth, use-mobile)
  router.tsx               router factory (per-request QueryClient)
  start.ts                 createStart() — registers attachSupabaseAuth middleware
  server.ts                Worker fetch handler + branded error page
```

### Server function pattern (critical)

- Define server fns in `src/lib/<feature>.functions.ts` with `createServerFn` from `@tanstack/react-start`, use `.inputValidator(zod)` then `.handler()` in one continuous chain.
- Put DB/integration work in `src/lib/<feature>.server.ts` and import from the `.functions.ts` file. `*.server.ts` is stripped from the client bundle.
- Do **not** place anything client-imported under `src/server/` — that path is blocked from the client bundle.
- Read `process.env.*` only inside `.handler()` bodies, not at module scope.
- Protected fns must use `.middleware([requireSupabaseAuth])` from `@/integrations/supabase/auth-middleware`. The matching global `attachSupabaseAuth` middleware is already registered in `src/start.ts` — don't replace that array, only append.
- Never call a `requireSupabaseAuth` server fn from a public route's `loader` (SSR/prerender has no session → 401 build break). Call from a component via `useServerFn` + `useQuery`, or put the route under `_authenticated/`.

### Routing rules

- Every route with a loader needs `errorComponent` and `notFoundComponent`. The root route also needs `notFoundComponent`.
- Layout files must render `<Outlet />` or child routes appear blank.
- Each crawlable public page lives at top-level, not duplicated under `_authenticated/`.
- For new shareable pages, set a per-route `head()` with unique title/description/OG tags.

### Styling & UX

- Tailwind v4 via `src/styles.css`. Use design tokens (e.g. `bg-background`, `text-foreground`, `text-muted-foreground`) — no raw hex or `text-white`/`bg-black`.
- Mobile-first responsive layouts. Use the existing shadcn components in `src/components/ui/` before introducing new primitives.
- Toasts: `sonner` (already wired via `<Toaster />` in `__root.tsx`).

### Code quality

- Strict TypeScript; every import must resolve before the build runs (Vite hard-fails on unresolved imports).
- Add new npm deps via `bun add <pkg>` — do not hand-edit `package.json` / lockfile.
- Use `try/catch` around server-fn calls and integrations; surface failures with `toast.error(...)`.
- Do not run `npm run build` / `tsc` manually — the harness builds automatically.

## 4. Database, Auth & API

### Auth

- Supabase Auth with email/password + Google. Sessions handled by `@/integrations/supabase/client`.
- Roles are stored in `public.user_roles` (enum `app_role`). The app's primary role is `workshop`. Check roles server-side with the `public.has_role(user_id, role)` security-definer function — never trust client-side role checks.
- Protected routes live under `src/routes/_authenticated/`. The layout (`_authenticated.tsx`) redirects unauthenticated users to `/login`.

### Database rules

Before modifying database schema:
- **Check existing RLS policies.** Understand who can read/write before adding or changing tables.
- **Never drop columns without explicit instruction.** Dropping data is destructive and irreversible.
- **Always create a new migration** rather than editing an old migration file. Old migrations are immutable history.
- **Every `CREATE TABLE` in `public` MUST** be followed in the same migration by:
  1. `GRANT` statements (`authenticated`, `service_role`, optionally `anon`),
  2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`,
  3. `CREATE POLICY ...`.
- **RLS policies should use `auth.uid()` and `public.has_role(auth.uid(), 'workshop')`.** No client-trusted role columns.
- **Forbidden schemas** (do not modify): `auth`, `storage`, `realtime`, `supabase_functions`, `vault`, `supabase/config.toml`.
- **Never edit existing migration files** — add a new one via Lovable's migration tool.
- **Do not regenerate Supabase types** unless a schema change requires it. Type regeneration is handled by the platform.

### Supabase clients (pick the right one)

- `@/integrations/supabase/client` — browser, publishable key, RLS applies. Use in React code.
- `@/integrations/supabase/auth-middleware` (`requireSupabaseAuth`) — server fns acting as the signed-in user with RLS.
- `@/integrations/supabase/client.server` (`supabaseAdmin`) — service role, **bypasses RLS**. Only for verified webhooks, admin/maintenance, or migrations seeding. Import lazily inside handlers (`const { supabaseAdmin } = await import('@/integrations/supabase/client.server')`) — top-level imports leak to the client bundle of `*.functions.ts` files.

### Realtime

- `jobs`, `status_updates`, and `messages` are published to Realtime. `realtime.messages` has RLS restricting channel subscriptions to `workshop`-role users — keep it that way.

### Webhooks & cron

- Live under `src/routes/api/public/*`. The `public` prefix bypasses auth on published sites, so every handler **must** verify the caller (signature, shared secret, or token) before doing anything.
- Stable URLs for external schedulers: `project--{id}.lovable.app` (prod) and `project--{id}-dev.lovable.app` (dev).

### Secrets

- Server-only secrets are injected as `process.env.*` (Lovable Cloud / connector secrets). Never log them, never return them in responses.
- Public config uses `import.meta.env.VITE_*`.
- `SUPABASE_SERVICE_ROLE_KEY` and the database password are not retrievable on Lovable Cloud — never instruct the user to fetch them.

## 5. Files & Areas You Must NOT Touch

These are auto-generated or owned by the Lovable integration; edits will be overwritten or will break builds:

- `src/routeTree.gen.ts`
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/client.server.ts`
- `src/integrations/supabase/auth-middleware.ts`
- `src/integrations/supabase/auth-attacher.ts`
- `src/integrations/supabase/types.ts`
- `.env` keys: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- `supabase/config.toml`
- Any file already inside `supabase/migrations/` (create a new migration instead)

Also avoid:

- Renaming or removing `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`, or `src/routes/_authenticated.tsx` — they are the bootstrap shell.
- Introducing `src/pages/`, React Router DOM, or Next/Remix-style `app/` folders — this is TanStack Start file-based routing only.
- Native-only Node packages (sharp, canvas, puppeteer, child_process, fs.watch, etc.) in server code — the Cloudflare Worker runtime does not support them.

## 6. Lovable Platform Rules

When making changes on a Lovable project:

- **Preserve Lovable integrations.** Do not break or bypass the Supabase client, auth middleware, or storage setup.
- **Do not modify auto-generated integration files.** Files under `src/integrations/supabase/` and `src/routeTree.gen.ts` are generated by the platform.
- **Do not regenerate Supabase types unless required.** Type files are maintained by the platform; manual edits cause drift.
- **Do not manually run database migrations.** Use the Lovable migration tool (`supabase--migration`) so changes are tracked and applied correctly.
- **Do not expose internal project IDs, Supabase URLs, or service role keys** in code comments, logs, or user-facing output.

## 7. UI Change Rules

Before modifying UI:

- **All customer-facing text must remain Swedish.** English is only for internal comments, variable names, and code.
- **Use existing shadcn/ui components** in `src/components/ui/` before introducing new primitives or custom styling.
- **Follow current Tailwind patterns.** Use semantic design tokens (`bg-background`, `text-foreground`, `text-muted-foreground`) — no raw hex codes or hardcoded colors like `text-white` / `bg-black`.
- **Mobile-first responsive layouts.** Test changes at mobile widths.
- **Do not re-introduce removed features** without asking — check git history / chat context first.

## 8. Agent Behavioral Constraints

- **Stay in scope.** Only change what the user asked for. UI tweaks stay in presentation code; don't refactor business logic on the side.
- **One concern per change.** Break large work into small, reviewable patches.
- **Confirm architectural shifts.** Ask before swapping libraries, redesigning data flow, or introducing new top-level abstractions.
- **No demo/mock data in the database.** Seed data belongs in a migration if needed.
- **Respect user language.** UI strings remain Swedish unless instructed otherwise.
- **Do not re-introduce removed features** without asking — check git history / chat context first.

### Think in classes of errors, not individual errors

When you find one bug, ask: *"what else in this same area could have the same root cause?"* Then fix the whole class before moving on. Examples:

- One wrong API field name → verify **all** field names in that payload against the official spec before committing.
- One missing timeout → add timeouts to **all** similar outbound calls in that file.
- One broken route link → check whether other links in the same component follow the same wrong pattern.
- One stale credential in a test → grep for the same credential across **all** test files.

Do not wait for the user to report each symptom individually. When a fix reveals a pattern, own that pattern fully. Consult the official documentation (use WebFetch) to verify the entire surface area, not just the reported field.

## 9. Testing & Debugging

- The Lovable harness runs build + typecheck automatically after edits. Do not run `npm run build`, `tsc`, or `vite build` manually.
- For runtime issues, check: console logs, network requests, server function logs, and the live preview. Use TanStack's `errorComponent` retry pattern (`router.invalidate()` + `reset()`).
- For DB issues, use the Lovable Cloud SQL tool / linter rather than guessing.
- If a fix doesn't work after 2–3 attempts, stop and re-investigate instead of looping — read the failing file fresh, check assumptions, and consider whether the problem is in a different layer (client vs server fn vs RLS vs migration).
- Always deliver fully working code — no placeholders, no "TODO: implement later" stubs in shipped changes.
