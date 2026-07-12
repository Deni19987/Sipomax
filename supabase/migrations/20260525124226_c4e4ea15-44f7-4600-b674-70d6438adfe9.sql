
-- 1) user_roles: explicitly deny INSERT/UPDATE/DELETE for clients (roles managed by backend only)
DROP POLICY IF EXISTS "No client inserts on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "No client updates on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "No client deletes on user_roles" ON public.user_roles;

CREATE POLICY "No client inserts on user_roles"
ON public.user_roles FOR INSERT TO authenticated, anon
WITH CHECK (false);

CREATE POLICY "No client updates on user_roles"
ON public.user_roles FOR UPDATE TO authenticated, anon
USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes on user_roles"
ON public.user_roles FOR DELETE TO authenticated, anon
USING (false);

-- 2) visma_connections: tokens must never be readable from client. Drop user-facing policy.
-- Only the service role (used server-side via supabaseAdmin) should access this table.
DROP POLICY IF EXISTS "Users manage own visma connection" ON public.visma_connections;
