-- Split customer_name into customer_first_name + customer_last_name.
-- customer_name is kept in sync as the concatenated display name.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS customer_first_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_last_name  TEXT;

-- Backfill from existing customer_name
UPDATE public.jobs
SET
  customer_first_name = TRIM(SPLIT_PART(customer_name, ' ', 1)),
  customer_last_name  = TRIM(SUBSTRING(customer_name FROM POSITION(' ' IN customer_name) + 1))
WHERE customer_first_name IS NULL;

-- For single-word names, customer_last_name should be empty string → NULL
UPDATE public.jobs
SET customer_last_name = NULL
WHERE customer_last_name = '' OR customer_last_name = customer_name;
