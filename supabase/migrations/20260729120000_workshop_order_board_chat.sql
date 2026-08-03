-- Orderöversikt + utbyggd verkstadschatt.
--
-- 1) Intern anteckning på ordern (syns bara för verkstaden).
-- 2) Omnämnanden (@medarbetare) och ordertaggar (#order) på chattmeddelanden.
-- 3) Läsmarkeringar per tråd, så listan kan visa olästa meddelanden.

-- 1) Intern anteckning ------------------------------------------------------
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS internal_note text;

-- 2) Omnämnanden och ordertaggar --------------------------------------------
-- mentions = user-id:n som taggats med @ i meddelandet (de får en notis).
-- order_refs = order-id:n som taggats med # i meddelandet (renderas som chip).
ALTER TABLE public.workshop_messages
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS order_refs uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS workshop_messages_mentions_idx
  ON public.workshop_messages USING GIN (mentions);

-- 3) Läsmarkeringar per tråd -------------------------------------------------
-- thread_key = 'general' för allmänna kanalen, annars order-id som text.
CREATE TABLE IF NOT EXISTS public.workshop_thread_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL,
  user_id uuid NOT NULL,
  thread_key text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, thread_key)
);

CREATE INDEX IF NOT EXISTS workshop_thread_reads_user_idx
  ON public.workshop_thread_reads (user_id, workshop_id);

GRANT SELECT, INSERT, UPDATE ON public.workshop_thread_reads TO authenticated;
GRANT ALL ON public.workshop_thread_reads TO service_role;

ALTER TABLE public.workshop_thread_reads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Members read own read markers" ON public.workshop_thread_reads
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Members create own read markers" ON public.workshop_thread_reads
    FOR INSERT TO authenticated
    WITH CHECK (
      user_id = auth.uid()
      AND workshop_id = public.member_workshop_id(auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Members update own read markers" ON public.workshop_thread_reads
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (
      user_id = auth.uid()
      AND workshop_id = public.member_workshop_id(auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
