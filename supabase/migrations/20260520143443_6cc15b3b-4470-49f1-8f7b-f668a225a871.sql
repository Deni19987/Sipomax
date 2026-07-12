
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS vehicle_color text,
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS vehicle_status text,
  ADD COLUMN IF NOT EXISTS owner_count integer,
  ADD COLUMN IF NOT EXISTS last_inspection_date date,
  ADD COLUMN IF NOT EXISTS next_inspection_date date,
  ADD COLUMN IF NOT EXISTS mileage integer;
