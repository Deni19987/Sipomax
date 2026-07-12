ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workshop users can subscribe to realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'workshop'::app_role));