
CREATE TABLE public.scandic_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  phone text NOT NULL,
  name text,
  email text,
  question text,
  status text NOT NULL DEFAULT 'pending',
  opted_out boolean NOT NULL DEFAULT false,
  last_reminder_kind text,
  initial_sent_at timestamptz,
  booking_token text NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, phone)
);
CREATE UNIQUE INDEX scandic_leads_booking_token_idx ON public.scandic_leads(booking_token);
CREATE INDEX scandic_leads_owner_idx ON public.scandic_leads(owner_id, created_at DESC);

ALTER TABLE public.scandic_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages scandic leads" ON public.scandic_leads
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER scandic_leads_touch BEFORE UPDATE ON public.scandic_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.scandic_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.scandic_leads(id) ON DELETE CASCADE,
  direction text NOT NULL,
  body text NOT NULL,
  reminder_kind text,
  elks_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scandic_messages_lead_idx ON public.scandic_messages(lead_id, created_at);

ALTER TABLE public.scandic_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages scandic messages" ON public.scandic_messages
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.scandic_leads l WHERE l.id = lead_id AND l.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.scandic_leads l WHERE l.id = lead_id AND l.owner_id = auth.uid()));

CREATE TABLE public.scandic_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.scandic_leads(id) ON DELETE CASCADE,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  name text,
  email text,
  phone text,
  question text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_start)
);
CREATE INDEX scandic_bookings_lead_idx ON public.scandic_bookings(lead_id);

ALTER TABLE public.scandic_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages scandic bookings" ON public.scandic_bookings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.scandic_leads l WHERE l.id = lead_id AND l.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.scandic_leads l WHERE l.id = lead_id AND l.owner_id = auth.uid()));
