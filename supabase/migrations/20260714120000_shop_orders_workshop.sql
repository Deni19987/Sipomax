-- Butiksordrar, verkstadschatt och kontotyper (kund vs verkstad).
--
-- Kundkonton lägger ordrar i butiken; verkstadskonton (ägare + inbjudna
-- medarbetare via account_owner_id) ser och hanterar sin verkstads ordrar,
-- statistik och intern chatt.

-- 1) Kontotyp på profiles ---------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'workshop',
  ADD COLUMN IF NOT EXISTS customer_of_workshop_id uuid;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_account_type_check CHECK (account_type IN ('workshop', 'customer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Hjälpfunktion: vilken verkstad tillhör en användare? -------------------
-- Ägare => eget id, medarbetare => ägarens id. Kundkonton får sitt eget id
-- tillbaka, vilket aldrig matchar en orders workshop_id.
CREATE OR REPLACE FUNCTION public.member_workshop_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(account_owner_id, id) FROM public.profiles WHERE id = _user_id),
    _user_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.member_workshop_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_workshop_id(uuid) TO authenticated, service_role;

-- 3) Ordrar -----------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.shop_order_number_seq START WITH 10001;

CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint NOT NULL UNIQUE DEFAULT nextval('public.shop_order_number_seq'),
  workshop_id uuid NOT NULL,
  customer_user_id uuid NOT NULL,
  customer_email text,
  customer_name text,
  customer_phone text,
  status text NOT NULL DEFAULT 'mottagen'
    CHECK (status IN ('mottagen', 'behandlas', 'skickad', 'levererad')),
  total numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shop_orders_workshop_idx ON public.shop_orders (workshop_id, created_at DESC);
CREATE INDEX shop_orders_customer_idx ON public.shop_orders (customer_user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.shop_orders TO authenticated;
GRANT ALL ON public.shop_orders TO service_role;
GRANT USAGE ON SEQUENCE public.shop_order_number_seq TO authenticated, service_role;

ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own or own workshop's orders" ON public.shop_orders
  FOR SELECT TO authenticated
  USING (
    customer_user_id = auth.uid()
    OR workshop_id = public.member_workshop_id(auth.uid())
  );

CREATE POLICY "Customers create own orders" ON public.shop_orders
  FOR INSERT TO authenticated
  WITH CHECK (customer_user_id = auth.uid());

CREATE POLICY "Workshop updates its orders" ON public.shop_orders
  FOR UPDATE TO authenticated
  USING (workshop_id = public.member_workshop_id(auth.uid()))
  WITH CHECK (workshop_id = public.member_workshop_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.shop_orders_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER shop_orders_touch_updated_at
  BEFORE UPDATE ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_touch_updated_at();

-- 4) Orderrader --------------------------------------------------------------
CREATE TABLE public.shop_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  name text NOT NULL,
  unit text,
  unit_price numeric(12,2) NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0)
);

CREATE INDEX shop_order_lines_order_idx ON public.shop_order_lines (order_id);

GRANT SELECT, INSERT ON public.shop_order_lines TO authenticated;
GRANT ALL ON public.shop_order_lines TO service_role;

ALTER TABLE public.shop_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read lines of visible orders" ON public.shop_order_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shop_orders o
    WHERE o.id = order_id
      AND (o.customer_user_id = auth.uid() OR o.workshop_id = public.member_workshop_id(auth.uid()))
  ));

CREATE POLICY "Insert lines on own orders" ON public.shop_order_lines
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.shop_orders o
    WHERE o.id = order_id AND o.customer_user_id = auth.uid()
  ));

-- 5) Intern verkstadschatt ----------------------------------------------------
-- order_id NULL = verkstadens allmänna kanal; annars tråd om en specifik order.
CREATE TABLE public.workshop_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL,
  order_id uuid REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_email text,
  sender_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workshop_messages_thread_idx
  ON public.workshop_messages (workshop_id, order_id, created_at);

GRANT SELECT, INSERT ON public.workshop_messages TO authenticated;
GRANT ALL ON public.workshop_messages TO service_role;

ALTER TABLE public.workshop_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workshop members read team chat" ON public.workshop_messages
  FOR SELECT TO authenticated
  USING (workshop_id = public.member_workshop_id(auth.uid()));

CREATE POLICY "Workshop members write team chat" ON public.workshop_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    workshop_id = public.member_workshop_id(auth.uid())
    AND sender_id = auth.uid()
  );
