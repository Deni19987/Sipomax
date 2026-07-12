-- Store the rendered invoice PDF (base64) on the job so it can be reopened
-- instantly without re-fetching from Fortnox.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS invoice_pdf_base64 text;
