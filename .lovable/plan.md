
# Schema-Only Migration to Your Own Supabase

Goal: move the app off Lovable Cloud onto your own Supabase project. Database structure carries over; no data, no storage files. You start with an empty DB and one admin account (you).

## What you'll end up with

- All tables, enums, RLS policies, GRANTs, functions (`has_role`, `handle_new_user`, `schedule_visma_invoice`, `touch_updated_at`), triggers, and the `job-attachments` storage bucket — recreated in your Supabase.
- One user (you) signed up with `hedisson@live.se`, which the app already treats as developer/admin.
- App secrets repointed to your project. Lovable Cloud is left attached but unused.

## What is NOT carried over

- Jobs, messages, status updates, attachments, opportunities, campaigns, ScandicReach leads/bookings/messages, push subscriptions.
- Storage files in `job-attachments`.
- Visma/Fortnox/Outlook connections — reconnect via OAuth in the app.

## Admin question (your actual question)

The app's "admin" is determined two ways, both handled by the schema:

1. **Hardcoded email check** — `hedisson@live.se` gets developer/admin powers automatically anywhere in the code.
2. **`user_roles` table** — the `handle_new_user` trigger auto-inserts every new signup as role `workshop` (the everyday staff role). If you want an explicit `admin` row too, you run one SQL line after signing up:
   ```sql
   INSERT INTO public.user_roles (user_id, role)
   VALUES ('<your-new-uuid>', 'admin');
   ```
   For day-to-day use, the email check alone is enough.

So: create yourself in the new Supabase dashboard (Auth → Users → Add user, Auto Confirm = on) using `hedisson@live.se`. The trigger fires, your `profiles` and `user_roles` rows are created automatically, and you're admin on login.

## Steps

### Phase 1 — Schema script (I prepare)
I concatenate every file in `supabase/migrations/` into one `migration-to-own-supabase.sql` at the project root. You open the new Supabase dashboard → SQL Editor → New query → paste → Run.

### Phase 2 — Create your admin user (you do in dashboard)
Authentication → Users → Add user → email `hedisson@live.se` + password → check "Auto Confirm User". The `handle_new_user` trigger inserts your `profiles` + `user_roles` rows.

### Phase 3 — Create the storage bucket (you do in dashboard)
Storage → New bucket → name `job-attachments`, private. (The schema script also tries to create it; either way works.)

### Phase 4 — Repoint app secrets (I trigger the secure form)
You paste from your new Supabase project's API settings:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

Then the dev server restarts and the app talks to your Supabase.

### Phase 5 — Enable auth providers (you do in dashboard)
- Email/password: on by default.
- Google: Authentication → Providers → Google → enable + paste client ID/secret from Google Cloud Console (if you want Google sign-in).

### Phase 6 — Reconnect integrations (you do in the app)
- Visma: app Settings → reconnect.
- Fortnox: app Settings → reconnect.
- Outlook: app Settings → reconnect.
- Push notifications: re-subscribe per device.

## First deliverable

When you approve this plan, I generate `migration-to-own-supabase.sql` and tell you exactly where to paste it.
