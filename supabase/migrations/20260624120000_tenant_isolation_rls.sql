-- Tenant isolation: tighten RLS so each workshop account can only access its
-- own rows. Previously all workshop-role users could read/write all rows.
-- Server functions use the admin client (bypasses RLS) so these policies are a
-- defense-in-depth layer that also protects direct Supabase client calls and
-- Realtime channel subscriptions from the workshop UI.

-- jobs: restrict to the creating user
DROP POLICY IF EXISTS "Workshop manages jobs" ON public.jobs;
CREATE POLICY "Workshop manages own jobs" ON public.jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop') AND created_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'workshop') AND created_by = auth.uid());

-- status_updates: restrict via parent job ownership
DROP POLICY IF EXISTS "Workshop manages status updates" ON public.status_updates;
CREATE POLICY "Workshop manages own status updates" ON public.status_updates
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = status_updates.job_id AND jobs.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = status_updates.job_id AND jobs.created_by = auth.uid()
    )
  );

-- status_update_attachments: restrict via status_update → job chain
DROP POLICY IF EXISTS "Workshop manages attachments" ON public.status_update_attachments;
CREATE POLICY "Workshop manages own attachments" ON public.status_update_attachments
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.status_updates su
      JOIN public.jobs j ON j.id = su.job_id
      WHERE su.id = status_update_attachments.status_update_id AND j.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.status_updates su
      JOIN public.jobs j ON j.id = su.job_id
      WHERE su.id = status_update_attachments.status_update_id AND j.created_by = auth.uid()
    )
  );

-- messages: restrict via parent job ownership
DROP POLICY IF EXISTS "Workshop manages messages" ON public.messages;
CREATE POLICY "Workshop manages own messages" ON public.messages
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = messages.job_id AND jobs.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = messages.job_id AND jobs.created_by = auth.uid()
    )
  );

-- opportunities: restrict to the creating user
DROP POLICY IF EXISTS "Workshop manages opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Workshop can read opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Workshop can create opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Workshop can update opportunities" ON public.opportunities;
CREATE POLICY "Workshop manages own opportunities" ON public.opportunities
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop') AND created_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'workshop') AND created_by = auth.uid());

-- campaigns: restrict to the creating user
DROP POLICY IF EXISTS "Workshop manages campaigns" ON public.campaigns;
CREATE POLICY "Workshop manages own campaigns" ON public.campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop') AND created_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'workshop') AND created_by = auth.uid());
