-- Add order_received to the job_status enum
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'order_received';

-- Chat SMS throttling columns on jobs
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS last_chat_sms_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_chat_reminder_at TIMESTAMPTZ;

-- Index for cron job picking up due reminders
CREATE INDEX IF NOT EXISTS idx_jobs_pending_chat_reminder
  ON jobs (pending_chat_reminder_at)
  WHERE pending_chat_reminder_at IS NOT NULL;
