-- Verkstadens egna produkter och kundkampanjer + publik lagring av produktbilder.
--
-- workshop_products: produkter en verkstad själv lägger upp i butiken. Utkast
-- syns bara för verkstaden; publicerade produkter syns för kunder.
-- workshop_campaigns: kampanjbubblor som visas på bestämda platser i kundappen
-- (varukorgen, startsidan, produktlistan) utifrån vald mall.

CREATE TABLE public.workshop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL,
  name text NOT NULL,
  brand text,
  category text NOT NULL DEFAULT 'tillbehor',
  description text,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  unit text,
  image_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workshop_products_workshop_idx ON public.workshop_products (workshop_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_products TO authenticated;
GRANT ALL ON public.workshop_products TO service_role;

ALTER TABLE public.workshop_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read published or own workshop products" ON public.workshop_products
  FOR SELECT TO authenticated
  USING (status = 'published' OR workshop_id = public.member_workshop_id(auth.uid()));

CREATE POLICY "Workshop writes own products" ON public.workshop_products
  FOR INSERT TO authenticated
  WITH CHECK (workshop_id = public.member_workshop_id(auth.uid()));

CREATE POLICY "Workshop updates own products" ON public.workshop_products
  FOR UPDATE TO authenticated
  USING (workshop_id = public.member_workshop_id(auth.uid()))
  WITH CHECK (workshop_id = public.member_workshop_id(auth.uid()));

CREATE POLICY "Workshop deletes own products" ON public.workshop_products
  FOR DELETE TO authenticated
  USING (workshop_id = public.member_workshop_id(auth.uid()));

CREATE TRIGGER workshop_products_touch_updated_at
  BEFORE UPDATE ON public.workshop_products
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_touch_updated_at();

CREATE TABLE public.workshop_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL,
  template text NOT NULL CHECK (template IN ('free_shipping', 'announcement', 'product_promo')),
  title text NOT NULL,
  message text NOT NULL,
  min_order numeric(12,2),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workshop_campaigns_workshop_idx ON public.workshop_campaigns (workshop_id, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_campaigns TO authenticated;
GRANT ALL ON public.workshop_campaigns TO service_role;

ALTER TABLE public.workshop_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read active or own workshop campaigns" ON public.workshop_campaigns
  FOR SELECT TO authenticated
  USING (active OR workshop_id = public.member_workshop_id(auth.uid()));

CREATE POLICY "Workshop writes own campaigns" ON public.workshop_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (workshop_id = public.member_workshop_id(auth.uid()));

CREATE POLICY "Workshop updates own campaigns" ON public.workshop_campaigns
  FOR UPDATE TO authenticated
  USING (workshop_id = public.member_workshop_id(auth.uid()))
  WITH CHECK (workshop_id = public.member_workshop_id(auth.uid()));

CREATE POLICY "Workshop deletes own campaigns" ON public.workshop_campaigns
  FOR DELETE TO authenticated
  USING (workshop_id = public.member_workshop_id(auth.uid()));

CREATE TRIGGER workshop_campaigns_touch_updated_at
  BEFORE UPDATE ON public.workshop_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_touch_updated_at();

-- Publik bucket för produktbilder (uppladdning sker server-side med service role).
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Public read product images" ON storage.objects
    FOR SELECT USING (bucket_id = 'product-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
