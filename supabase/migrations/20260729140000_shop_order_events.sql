-- Orderhistorik: varje åtgärd på en order loggas automatiskt och visas under
-- fliken "Historik" i verkstadens ordervy.
--
-- actor_id är null när händelsen kommer från kundsidan (t.ex. lagd order).
-- Historiken är intern och läses bara av verkstadens medlemmar.

CREATE TABLE IF NOT EXISTS public.shop_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  workshop_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  type text NOT NULL CHECK (type IN ('created', 'status_changed', 'note_updated', 'comment')),
  from_status text,
  to_status text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_order_events_order_idx
  ON public.shop_order_events (order_id, created_at DESC);

GRANT SELECT, INSERT ON public.shop_order_events TO authenticated;
GRANT ALL ON public.shop_order_events TO service_role;

ALTER TABLE public.shop_order_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Workshop members read order history" ON public.shop_order_events
    FOR SELECT TO authenticated
    USING (workshop_id = public.member_workshop_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Workshop members write order history" ON public.shop_order_events
    FOR INSERT TO authenticated
    WITH CHECK (workshop_id = public.member_workshop_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
