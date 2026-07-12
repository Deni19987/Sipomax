
DO $$ BEGIN
  CREATE TYPE public.campaign_status AS ENUM ('pending', 'approved', 'sent', 'failed', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS mileage_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS mileage_source text,
  ADD COLUMN IF NOT EXISTS mileage_at_last_service integer,
  ADD COLUMN IF NOT EXISTS last_service_at timestamptz,
  ADD COLUMN IF NOT EXISTS avg_km_per_month numeric,
  ADD COLUMN IF NOT EXISTS engine_type text,
  ADD COLUMN IF NOT EXISTS engine_code text,
  ADD COLUMN IF NOT EXISTS gearbox_type text,
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS model_year integer,
  ADD COLUMN IF NOT EXISTS recommended_service_interval_km integer,
  ADD COLUMN IF NOT EXISTS recommended_service_interval_months integer;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  campaign_type text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  suggested_message text NOT NULL,
  suggested_send_at timestamptz NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.campaign_status NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  send_error text,
  send_results jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workshop manages campaigns" ON public.campaigns;
CREATE POLICY "Workshop manages campaigns" ON public.campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'workshop'::app_role));

DROP TRIGGER IF EXISTS touch_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER touch_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
