
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS customer_org_number text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS billing_postal_code text,
  ADD COLUMN IF NOT EXISTS billing_city text,
  ADD COLUMN IF NOT EXISTS invoice_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS visma_invoice_id text,
  ADD COLUMN IF NOT EXISTS invoice_error text;

-- Trigger: when a job's current_status first becomes 'job_done', schedule invoice 5 days out
CREATE OR REPLACE FUNCTION public.schedule_visma_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.current_status = 'job_done'
     AND (OLD.current_status IS DISTINCT FROM 'job_done')
     AND NEW.invoice_scheduled_at IS NULL
     AND NEW.invoice_generated_at IS NULL THEN
    NEW.invoice_scheduled_at := now() + interval '5 days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_visma_invoice ON public.jobs;
CREATE TRIGGER trg_schedule_visma_invoice
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.schedule_visma_invoice();

-- Visma per-user OAuth connections
CREATE TABLE IF NOT EXISTS public.visma_connections (
  user_id uuid PRIMARY KEY,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  company_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visma_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own visma connection"
ON public.visma_connections
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Enable extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
