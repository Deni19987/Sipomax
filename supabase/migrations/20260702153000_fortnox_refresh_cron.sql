-- Schedules the fortnox-refresh Edge Function to run every 5 minutes, so
-- Fortnox token rotation happens on a background timer instead of inline
-- during a live user request. See supabase/functions/fortnox-refresh/index.ts
-- for why: a live-request refresh can be frozen/killed by the serverless
-- runtime after Fortnox has already rotated the token but before we saved
-- it, permanently wedging the connection — confirmed in production on
-- 2026-07-02 via the fortnox_refresh_events audit trail.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- The shared secret the cron job sends (as `x-cron-secret`) so the Edge
-- Function can verify the call actually came from our own pg_cron and not an
-- arbitrary internet request. The secret's VALUE is intentionally not in this
-- file — it lives in Supabase Vault (`select vault.create_secret(...)`, run
-- once directly against the project, not checked into git) under the name
-- 'fortnox_cron_secret', and must match the Edge Function's CRON_SECRET
-- secret (`supabase secrets set CRON_SECRET=...`). Setting up a new
-- environment requires creating both by hand.
SELECT cron.schedule(
  'fortnox-token-refresh',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/fortnox-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fortnox_cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
