-- Statusen "behandlas" byter namn till "packad".
--
-- "Behandlas" sa inget om vad verkstaden faktiskt gjort. "Packad" är steget
-- där ordern är plockad, packad och redo att lämna verkstaden — det är den
-- informationen både personalen och kunden behöver.

ALTER TABLE public.shop_orders
  DROP CONSTRAINT IF EXISTS shop_orders_status_check;

UPDATE public.shop_orders SET status = 'packad' WHERE status = 'behandlas';
UPDATE public.shop_order_events SET from_status = 'packad' WHERE from_status = 'behandlas';
UPDATE public.shop_order_events SET to_status = 'packad' WHERE to_status = 'behandlas';

ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_status_check
  CHECK (status IN ('mottagen', 'packad', 'skickad', 'levererad'));

-- Avslutade ordrar (levererade och betalda) lämnar orderlistan. Indexet gör
-- det billigt att hämta bara de ordrar som fortfarande är aktiva.
CREATE INDEX IF NOT EXISTS shop_orders_open_idx
  ON public.shop_orders (workshop_id, created_at DESC)
  WHERE NOT (status = 'levererad' AND payment_status = 'betald');
