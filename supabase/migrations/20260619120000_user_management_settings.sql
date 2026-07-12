-- Per-user feature flags, managed by admins from the "Hantera användare"
-- settings page. Toggle visibility of the Uppföljningar (opportunities) and
-- Kampanjer (campaigns) pages/buttons for individual users.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS opportunities_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS campaigns_enabled boolean NOT NULL DEFAULT true;
