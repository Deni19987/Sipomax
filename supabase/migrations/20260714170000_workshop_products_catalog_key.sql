-- Spårar vilken statisk katalogprodukt en verkstadsproduktrad seedades från.
-- Gör att butikens baskatalog kan kopieras in i varje verkstads egna produkter
-- (workshop_products) exakt en gång, så att kundvyn och "Mina produkter" alltid
-- speglar samma data.

ALTER TABLE public.workshop_products
  ADD COLUMN IF NOT EXISTS catalog_key text;

-- Samma katalogprodukt får bara seedas en gång per verkstad.
CREATE UNIQUE INDEX IF NOT EXISTS workshop_products_catalog_key_uniq
  ON public.workshop_products (workshop_id, catalog_key)
  WHERE catalog_key IS NOT NULL;
