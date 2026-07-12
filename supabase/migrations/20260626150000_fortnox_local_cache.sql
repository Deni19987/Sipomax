-- Local cache of Fortnox customers and articles, per workshop.
--
-- Searching customers/articles previously hit the Fortnox API on every
-- keystroke/focus (fetching up to 500 customers / 200 articles each time).
-- These tables mirror the workshop's Fortnox data so search runs against the
-- local database instead. They are refreshed in the background when stale and
-- updated immediately whenever a customer/article is created or edited.

CREATE TABLE IF NOT EXISTS public.fortnox_customers_cache (
  workshop_id     uuid NOT NULL,
  customer_number text NOT NULL,
  name            text,
  email           text,
  phone           text,
  org_number      text,
  address         text,
  zip_code        text,
  city            text,
  -- Precomputed lowercase haystack (name, number, email, org nr, address, city,
  -- and phone digit variants) so search is a single ILIKE.
  search_text     text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workshop_id, customer_number)
);

CREATE INDEX IF NOT EXISTS fortnox_customers_cache_search_idx
  ON public.fortnox_customers_cache (workshop_id);

CREATE TABLE IF NOT EXISTS public.fortnox_articles_cache (
  workshop_id    uuid NOT NULL,
  article_number text NOT NULL,
  description    text,
  sales_price    numeric,
  unit           text,
  vat            numeric,
  search_text    text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workshop_id, article_number)
);

CREATE INDEX IF NOT EXISTS fortnox_articles_cache_search_idx
  ON public.fortnox_articles_cache (workshop_id);

-- Tracks when each cache kind was last fully synced from Fortnox, so the
-- background refresh knows whether the data is stale.
CREATE TABLE IF NOT EXISTS public.fortnox_cache_meta (
  workshop_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('customers','articles')),
  synced_at   timestamptz,
  PRIMARY KEY (workshop_id, kind)
);

-- All access is server-side via the service role (which bypasses RLS). Enable
-- RLS with no permissive policies so the cache is never readable cross-tenant
-- through the anon/authenticated keys.
ALTER TABLE public.fortnox_customers_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fortnox_articles_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fortnox_cache_meta      ENABLE ROW LEVEL SECURITY;
