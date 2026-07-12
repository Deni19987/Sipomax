-- Explicit deny-all policies on visma_connections so the linter sees coverage.
-- Only the service role (used by server functions/admin) can access this table.
REVOKE ALL ON public.visma_connections FROM anon, authenticated;
GRANT ALL ON public.visma_connections TO service_role;

CREATE POLICY "Deny client select" ON public.visma_connections
  FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "Deny client insert" ON public.visma_connections
  FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "Deny client update" ON public.visma_connections
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Deny client delete" ON public.visma_connections
  FOR DELETE TO anon, authenticated USING (false);