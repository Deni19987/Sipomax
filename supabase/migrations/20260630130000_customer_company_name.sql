-- Optional company name for a job's customer. When set, this is the
-- official/Fortnox-facing name (customer_name resolves to this value);
-- when empty, customer_name falls back to the personal first/last name.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS customer_company_name TEXT;
