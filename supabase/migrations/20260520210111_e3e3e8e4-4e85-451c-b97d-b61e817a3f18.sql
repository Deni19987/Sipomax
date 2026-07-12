ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS opportunity_prompt_base text,
  ADD COLUMN IF NOT EXISTS service_prompt_base text;