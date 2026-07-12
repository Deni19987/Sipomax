
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TYPE public.opportunity_status AS ENUM ('pending', 'approved', 'sent', 'failed', 'dismissed');

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text,
  opportunity_type text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  suggested_message text NOT NULL,
  suggested_send_at timestamptz NOT NULL,
  status public.opportunity_status NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  send_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_opportunities_status_send ON public.opportunities(status, suggested_send_at);
CREATE INDEX idx_opportunities_created_by ON public.opportunities(created_by);

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workshop manages opportunities"
ON public.opportunities FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'workshop'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'workshop'::app_role));

CREATE TRIGGER set_opportunities_updated_at
BEFORE UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
