ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS identifier_type TEXT NOT NULL DEFAULT 'registration'
    CHECK (identifier_type IN ('registration', 'article'));
