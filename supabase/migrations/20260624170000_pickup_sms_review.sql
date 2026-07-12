-- Add configurable review-request toggle and message to the pickup SMS feature.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pickup_sms_review_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_sms_review_message text;
