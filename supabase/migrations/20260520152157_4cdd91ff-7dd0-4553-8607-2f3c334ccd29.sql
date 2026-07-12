
-- Extend profiles with workshop settings
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS workshop_address text,
  ADD COLUMN IF NOT EXISTS invoice_delay_days integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS pickup_sms_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_signature text;

-- Allow workshop users to insert their own profile row (needed for upsert)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Update the invoice scheduling trigger to use the user's preferred delay
CREATE OR REPLACE FUNCTION public.schedule_visma_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  delay_days integer := 5;
BEGIN
  IF NEW.current_status = 'job_done'
     AND (OLD.current_status IS DISTINCT FROM 'job_done')
     AND NEW.invoice_scheduled_at IS NULL
     AND NEW.invoice_generated_at IS NULL THEN
    IF NEW.created_by IS NOT NULL THEN
      SELECT COALESCE(p.invoice_delay_days, 5) INTO delay_days
      FROM public.profiles p
      WHERE p.id = NEW.created_by;
    END IF;
    NEW.invoice_scheduled_at := now() + make_interval(days => delay_days);
  END IF;
  RETURN NEW;
END;
$function$;
