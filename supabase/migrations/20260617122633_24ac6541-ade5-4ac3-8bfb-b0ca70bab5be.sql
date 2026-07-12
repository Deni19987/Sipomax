-- The migration before this one created an earlier, narrower shape of this
-- table. In the original project's history that shape was replaced by hand
-- (Lovable Cloud dashboard) rather than through a captured migration, so a
-- fresh replay of this file needs an explicit drop before recreating it here.
DROP TABLE IF EXISTS public.fortnox_connections CASCADE;

CREATE TABLE public.fortnox_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fortnox_connections TO authenticated;
GRANT ALL ON public.fortnox_connections TO service_role;

ALTER TABLE public.fortnox_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own fortnox connection"
  ON public.fortnox_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own fortnox connection"
  ON public.fortnox_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own fortnox connection"
  ON public.fortnox_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own fortnox connection"
  ON public.fortnox_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER fortnox_connections_touch_updated_at
  BEFORE UPDATE ON public.fortnox_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();