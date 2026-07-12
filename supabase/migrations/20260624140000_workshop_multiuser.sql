-- Multi-user workshop architecture.
-- Each workshop owner can invite team members who share the same data.
-- A new workshop_id column (set to the owner's user ID) replaces per-user
-- created_by scoping. Team membership is tracked via account_owner_id on profiles.
-- Developer impersonation is tracked via impersonating_workshop_id on profiles.

-- profiles: multi-user workshop columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS impersonating_workshop_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_account_owner ON public.profiles(account_owner_id);

-- jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS workshop_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.jobs SET workshop_id = created_by WHERE workshop_id IS NULL AND created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_workshop ON public.jobs(workshop_id);

-- opportunities
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS workshop_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.opportunities SET workshop_id = created_by WHERE workshop_id IS NULL AND created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_workshop ON public.opportunities(workshop_id);

-- campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workshop_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.campaigns SET workshop_id = created_by WHERE workshop_id IS NULL AND created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_workshop ON public.campaigns(workshop_id);

-- Helper: returns true if _user_id owns or is a member of _workshop_id
CREATE OR REPLACE FUNCTION public.is_workshop_member(_user_id UUID, _workshop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    _user_id = _workshop_id OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = _user_id AND account_owner_id = _workshop_id
    )
$$;

-- Update RLS to use workshop_id + is_workshop_member

-- jobs
DROP POLICY IF EXISTS "Workshop manages own jobs" ON public.jobs;
CREATE POLICY "Workshop manages workshop jobs" ON public.jobs
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    public.is_workshop_member(auth.uid(), workshop_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    public.is_workshop_member(auth.uid(), workshop_id)
  );

-- status_updates: scope via parent job's workshop_id
DROP POLICY IF EXISTS "Workshop manages own status updates" ON public.status_updates;
CREATE POLICY "Workshop manages workshop status updates" ON public.status_updates
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = status_updates.job_id
        AND public.is_workshop_member(auth.uid(), jobs.workshop_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = status_updates.job_id
        AND public.is_workshop_member(auth.uid(), jobs.workshop_id)
    )
  );

-- attachments: scope via status_update → job chain
DROP POLICY IF EXISTS "Workshop manages own attachments" ON public.status_update_attachments;
CREATE POLICY "Workshop manages workshop attachments" ON public.status_update_attachments
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.status_updates su
      JOIN public.jobs j ON j.id = su.job_id
      WHERE su.id = status_update_attachments.status_update_id
        AND public.is_workshop_member(auth.uid(), j.workshop_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.status_updates su
      JOIN public.jobs j ON j.id = su.job_id
      WHERE su.id = status_update_attachments.status_update_id
        AND public.is_workshop_member(auth.uid(), j.workshop_id)
    )
  );

-- messages: scope via parent job's workshop_id
DROP POLICY IF EXISTS "Workshop manages own messages" ON public.messages;
CREATE POLICY "Workshop manages workshop messages" ON public.messages
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = messages.job_id
        AND public.is_workshop_member(auth.uid(), jobs.workshop_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = messages.job_id
        AND public.is_workshop_member(auth.uid(), jobs.workshop_id)
    )
  );

-- opportunities
DROP POLICY IF EXISTS "Workshop manages own opportunities" ON public.opportunities;
CREATE POLICY "Workshop manages workshop opportunities" ON public.opportunities
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    public.is_workshop_member(auth.uid(), workshop_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    public.is_workshop_member(auth.uid(), workshop_id)
  );

-- campaigns
DROP POLICY IF EXISTS "Workshop manages own campaigns" ON public.campaigns;
CREATE POLICY "Workshop manages workshop campaigns" ON public.campaigns
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'workshop') AND
    public.is_workshop_member(auth.uid(), workshop_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'workshop') AND
    public.is_workshop_member(auth.uid(), workshop_id)
  );
