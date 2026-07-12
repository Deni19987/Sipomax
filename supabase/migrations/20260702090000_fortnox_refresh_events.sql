-- Persistent audit trail for Fortnox token refreshes.
--
-- Fortnox rotates the refresh_token on every use and immediately invalidates
-- the previous one. If the serverless process is killed between Fortnox
-- rotating the token and us persisting the new one (e.g. the Netlify function
-- timeout fires mid-request), the connection is permanently wedged — and a
-- dead process can never write a console log, so Netlify function logs cannot
-- capture this failure mode at all. This table can: a row is inserted BEFORE
-- the token call and updated after it finishes, so a row whose finished_at is
-- NULL means the process died mid-rotation. Rows survive Netlify's short log
-- retention and are queryable long after the fact.
CREATE TABLE IF NOT EXISTS public.fortnox_refresh_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  -- what caused the refresh: 'expiry-buffer' (proactive) or '401-retry'
  trigger_reason text NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  -- sha256 prefix of the refresh_token used, to prove WHICH token was spent
  token_fingerprint text,
  -- expires_at of the connection before this refresh ran
  old_expires_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- 'success' | 'token-error' (Fortnox rejected/failed the token call)
  -- | 'store-error' (Fortnox rotated the token but the DB write failed — the
  --   dangerous wedge case). NULL with finished_at NULL = process died mid-flight.
  outcome text,
  error_status integer,
  error_body text,
  duration_ms integer
);

-- Server-only table: RLS enabled with no policies, so only the service role
-- (which bypasses RLS) can read or write it.
ALTER TABLE public.fortnox_refresh_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS fortnox_refresh_events_user_started_idx
  ON public.fortnox_refresh_events (user_id, started_at DESC);
