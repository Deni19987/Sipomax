-- Article-based offers + an editable invoice working set for the Fortnox flow.
--
-- Offers (quote_sent) are now built from Fortnox articles. Each offer stores its
-- selected article lines so the confirmed offers can seed the final invoice.
-- Shape: [{ "article_number": "10", "description": "Oljebyte", "quantity": 1,
--           "unit_price": 495, "vat": 25 }]
ALTER TABLE public.status_updates
  ADD COLUMN IF NOT EXISTS articles jsonb;

-- The editable working set of invoice rows on the "Faktura" page. Seeded from the
-- confirmed offers' articles, then adjustable (add/delete/temporary price) before
-- the invoice + customer are created in Fortnox.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS invoice_articles jsonb;
