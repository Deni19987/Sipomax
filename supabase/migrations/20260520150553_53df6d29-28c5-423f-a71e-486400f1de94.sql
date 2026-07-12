ALTER TABLE public.jobs
  ALTER COLUMN last_inspection_date TYPE text USING last_inspection_date::text,
  ALTER COLUMN next_inspection_date TYPE text USING next_inspection_date::text;