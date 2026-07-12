-- Company info fields for invoice PDF generation
alter table public.profiles
  add column if not exists company_zip_code   text,
  add column if not exists company_city       text,
  add column if not exists company_org_number text,
  add column if not exists company_vat_number text;
