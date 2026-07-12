ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS fortnox_invoice_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invoice_provider TEXT NOT NULL DEFAULT 'visma';