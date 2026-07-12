-- Invoice PDF settings per user profile
alter table public.profiles
  add column if not exists invoice_logo_url   text,
  add column if not exists invoice_bank_details jsonb,
  add column if not exists invoice_accent_color text default '#1a56db';

-- Public storage bucket for invoice logos
insert into storage.buckets (id, name, public)
values ('invoice-logos', 'invoice-logos', true)
on conflict (id) do nothing;

-- Anyone authenticated can upload their own logo
create policy "Users can upload their own invoice logo"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'invoice-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own invoice logo"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'invoice-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own invoice logo"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'invoice-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Public read for logos (they appear on invoices)
create policy "Public read invoice logos"
  on storage.objects for select
  to public
  using (bucket_id = 'invoice-logos');
