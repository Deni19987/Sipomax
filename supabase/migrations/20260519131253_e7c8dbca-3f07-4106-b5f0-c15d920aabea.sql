ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'car_dropped_off' BEFORE 'started_work';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'car_picked_up';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_review_url TEXT;