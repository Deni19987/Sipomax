-- Fortnox invoice integration: per-user OAuth connections + provider selection.

-- Track the Fortnox invoice/document number per job (parallel to visma_invoice_id).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS fortnox_invoice_id text;

-- Which invoice integration is active for the user. Existing users keep Visma.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invoice_provider text NOT NULL DEFAULT 'visma'
    CHECK (invoice_provider IN ('visma','fortnox'));

-- Fortnox per-user OAuth connections (mirrors visma_connections).
CREATE TABLE IF NOT EXISTS public.fortnox_connections (
  user_id uuid PRIMARY KEY,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  company_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fortnox_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fortnox connection"
ON public.fortnox_connections
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
