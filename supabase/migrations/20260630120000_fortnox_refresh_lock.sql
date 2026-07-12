-- Fortnox rotates the refresh_token on every use and immediately invalidates the
-- previous one. In a serverless environment, concurrent requests run in separate
-- processes that can each read the same stale refresh_token and race to use it —
-- the loser gets invalid_grant, which previously surfaced as "Fortnox-anslutningen
-- har upphört att gälla" and required a full manual reconnect even though the
-- connection itself was fine. This column lets refreshAccessTokenForUser claim an
-- exclusive cross-process lock (via an atomic UPDATE ... WHERE) before calling
-- Fortnox, so only one process ever rotates the token at a time; others wait and
-- read back the winner's result instead of racing.
ALTER TABLE public.fortnox_connections
  ADD COLUMN IF NOT EXISTS refreshing_at timestamptz;
