-- Remove the configurable invoice delay. Invoices are now scheduled
-- immediately when a job is marked done (the cron picks them up on its next
-- run), and the manual "generera faktura" action already runs immediately.

-- Schedule the invoice for "now" instead of now() + delay_days.
CREATE OR REPLACE FUNCTION public.schedule_visma_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.current_status = 'job_done'
     AND (OLD.current_status IS DISTINCT FROM 'job_done')
     AND NEW.invoice_scheduled_at IS NULL
     AND NEW.invoice_generated_at IS NULL THEN
    NEW.invoice_scheduled_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- The delay setting no longer exists.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS invoice_delay_days;
