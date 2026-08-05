-- Fortnox i butiksflödet: automatisk faktura på levererad order, envägssynk av
-- artiklar (appen → Fortnox) och avklarad order när fakturan betalats.
--
-- Flödet:
--   1. Verkstaden ansluter Fortnox. Första gången importeras alla befintliga
--      Fortnox-artiklar till workshop_products (source = 'fortnox').
--   2. Därefter är synken enkelriktad: produkter som skapas/ändras i appen
--      speglas till Fortnox. Artiklar som skapas direkt i Fortnox syns inte.
--   3. När en order markeras som levererad skapas en faktura i Fortnox med
--      orderns alla rader.
--   4. När fakturan är betald i Fortnox flyttas ordern från "levererad" till
--      "avklarad" och hamnar på kundkortet som avslutad.

-- 1) Order: ny slutstatus, returstatus och koppling till Fortnox-fakturan ----

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS fortnox_invoice_id text,
  ADD COLUMN IF NOT EXISTS fortnox_customer_number text,
  ADD COLUMN IF NOT EXISTS invoice_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_due_date date,
  ADD COLUMN IF NOT EXISTS invoice_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS invoice_balance numeric(12,2),
  ADD COLUMN IF NOT EXISTS invoice_booked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_error text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS shop_orders_invoice_idx
  ON public.shop_orders (workshop_id, status)
  WHERE fortnox_invoice_id IS NOT NULL;

-- "avklarad" = fakturan är betald i Fortnox och ordern är helt klar.
ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_status_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_status_check
  CHECK (status IN ('mottagen', 'behandlas', 'skickad', 'levererad', 'avklarad'));

-- "retur" = varan är på väg tillbaka, ordern ska inte betalas som den ligger.
ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_payment_status_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_payment_status_check
  CHECK (payment_status IN ('obetald', 'betald', 'fakturerad', 'retur', 'aterbetald'));

-- Historiken loggar även fakturahändelserna.
ALTER TABLE public.shop_order_events DROP CONSTRAINT IF EXISTS shop_order_events_type_check;
ALTER TABLE public.shop_order_events
  ADD CONSTRAINT shop_order_events_type_check
  CHECK (type IN (
    'created',
    'status_changed',
    'note_updated',
    'comment',
    'payment_changed',
    'shipping_updated',
    'invoice_created',
    'invoice_failed',
    'invoice_paid'
  ));

-- 2) Produkter: koppling till Fortnox-artikeln --------------------------------

ALTER TABLE public.workshop_products
  ADD COLUMN IF NOT EXISTS fortnox_article_number text,
  ADD COLUMN IF NOT EXISTS fortnox_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS fortnox_sync_error text,
  -- 'app'     = skapad i Sipomax (synkas till Fortnox)
  -- 'fortnox' = hämtad vid den initiala importen
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

DO $$ BEGIN
  ALTER TABLE public.workshop_products
    ADD CONSTRAINT workshop_products_source_check CHECK (source IN ('app', 'fortnox'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Samma Fortnox-artikel får bara finnas som en produkt per verkstad, annars
-- skulle en ny import skapa dubbletter av redan importerade artiklar.
CREATE UNIQUE INDEX IF NOT EXISTS workshop_products_fortnox_article_idx
  ON public.workshop_products (workshop_id, fortnox_article_number)
  WHERE fortnox_article_number IS NOT NULL;

-- 3) Den initiala artikelimporten körs en gång per verkstad -------------------
-- fortnox_cache_meta.kind får ett nytt värde som markerar att importen är
-- gjord; efter det skapas produkter bara i appen.
ALTER TABLE public.fortnox_cache_meta DROP CONSTRAINT IF EXISTS fortnox_cache_meta_kind_check;
ALTER TABLE public.fortnox_cache_meta
  ADD CONSTRAINT fortnox_cache_meta_kind_check
  CHECK (kind IN ('customers', 'articles', 'shop_article_import'));
