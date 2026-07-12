ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS trigger_message_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trigger_context text;