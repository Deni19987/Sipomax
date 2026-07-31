-- Betalstatus, leveransadress och frakt på ordern.
--
-- Verkstaden behöver se hela bilden när en order öppnas: vem som beställt,
-- vad, om det är betalt, vart det ska och hur det skickats.

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'obetald',
  ADD COLUMN IF NOT EXISTS shipping_recipient text,
  ADD COLUMN IF NOT EXISTS shipping_street text,
  ADD COLUMN IF NOT EXISTS shipping_postal_code text,
  ADD COLUMN IF NOT EXISTS shipping_city text,
  ADD COLUMN IF NOT EXISTS shipping_country text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS tracking_number text;

DO $$ BEGIN
  ALTER TABLE public.shop_orders
    ADD CONSTRAINT shop_orders_payment_status_check
    CHECK (payment_status IN ('obetald', 'betald', 'fakturerad', 'aterbetald'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Historiken loggar nu även betalning och frakt.
ALTER TABLE public.shop_order_events
  DROP CONSTRAINT IF EXISTS shop_order_events_type_check;

ALTER TABLE public.shop_order_events
  ADD CONSTRAINT shop_order_events_type_check
  CHECK (type IN (
    'created',
    'status_changed',
    'note_updated',
    'comment',
    'payment_changed',
    'shipping_updated'
  ));
