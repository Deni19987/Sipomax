
-- Enums
CREATE TYPE public.app_role AS ENUM ('workshop', 'admin');
CREATE TYPE public.job_status AS ENUM ('started_work', 'quote_sent', 'quote_approved', 'quote_rejected', 'in_progress', 'job_done');
CREATE TYPE public.sender_type AS ENUM ('workshop', 'customer');
CREATE TYPE public.approval_state AS ENUM ('pending', 'approved', 'rejected');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Auto-create profile + workshop role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'workshop');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Jobs
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  registration_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  notes TEXT,
  current_status public.job_status NOT NULL DEFAULT 'started_work',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_jobs_token ON public.jobs(job_token);
CREATE INDEX idx_jobs_reg ON public.jobs(lower(registration_number));

-- Status updates
CREATE TABLE public.status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status public.job_status NOT NULL,
  description TEXT,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approval_state public.approval_state,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.status_updates ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_status_updates_job ON public.status_updates(job_id, created_at);

-- Attachments
CREATE TABLE public.status_update_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_update_id UUID NOT NULL REFERENCES public.status_updates(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.status_update_attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_attachments_update ON public.status_update_attachments(status_update_id);

-- Messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_type public.sender_type NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_messages_job ON public.messages(job_id, created_at);

-- RLS Policies — workshop role can do everything; customer access is via server fns (admin client)

-- profiles
CREATE POLICY "Workshop can view all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'workshop'));
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- jobs
CREATE POLICY "Workshop manages jobs" ON public.jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop'))
  WITH CHECK (public.has_role(auth.uid(), 'workshop'));

-- status_updates
CREATE POLICY "Workshop manages status updates" ON public.status_updates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop'))
  WITH CHECK (public.has_role(auth.uid(), 'workshop'));

-- attachments
CREATE POLICY "Workshop manages attachments" ON public.status_update_attachments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop'))
  WITH CHECK (public.has_role(auth.uid(), 'workshop'));

-- messages
CREATE POLICY "Workshop manages messages" ON public.messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'workshop'))
  WITH CHECK (public.has_role(auth.uid(), 'workshop'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.status_updates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('job-attachments', 'job-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Workshop can upload attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-attachments' AND public.has_role(auth.uid(), 'workshop'));
CREATE POLICY "Workshop can manage attachments" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'job-attachments' AND public.has_role(auth.uid(), 'workshop'));
CREATE POLICY "Public can read attachments" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'job-attachments');
