-- Track when an invoice was actually bookkept in Fortnox, distinct from
-- invoice_booked_at (which is set for every finalize action — book, send,
-- or book_send — regardless of whether bookkeeping actually happened).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS invoice_bookkept_at timestamptz;
