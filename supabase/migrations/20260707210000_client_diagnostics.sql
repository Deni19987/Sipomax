-- Temporary diagnostics sink for the open-invoice investigation: the failure
-- reloads the page on the phone, destroying any client-side evidence, so each
-- step is beaconed to the server and stored here. Read via
-- /api/public/client-log?key=... . Drop the table when the bug is fixed.
CREATE TABLE IF NOT EXISTS public.client_diagnostics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  session text,
  step text NOT NULL,
  detail text
);
-- Service-role access only (no policies on purpose).
ALTER TABLE public.client_diagnostics ENABLE ROW LEVEL SECURITY;
