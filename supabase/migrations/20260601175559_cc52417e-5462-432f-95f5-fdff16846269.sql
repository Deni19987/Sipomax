ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_customer_messages boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_pending_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pending_reminder_last_sent_at timestamptz;