-- Frozen snapshot of everything the invoice PDF render needs, captured once
-- when the invoice is booked/sent: the full Fortnox invoice as it existed at
-- that moment plus the workshop's company details (name, address, bank
-- details, logo). Opening the invoice later re-renders from this snapshot —
-- same pipeline as "Förhandsgranska" — so the customer always sees the
-- document as issued, no matter how profile data or render code change later.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS invoice_snapshot jsonb;
