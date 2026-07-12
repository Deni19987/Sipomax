
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS opportunity_prompt_extra text,
  ADD COLUMN IF NOT EXISTS service_prompt_extra text,
  ADD COLUMN IF NOT EXISTS service_metrics text[];
