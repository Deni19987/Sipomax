-- Store the Fortnox customer number directly on the job at creation time.
-- This lets the invoice generation step use the pre-linked customer instead
-- of having to search/create one again.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS fortnox_customer_number TEXT;
