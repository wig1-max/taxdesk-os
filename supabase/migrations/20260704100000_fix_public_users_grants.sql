-- Fix public.users privileges for auth/profile checks.
-- RLS remains enabled. These grants only allow table access;
-- row-level access is still controlled by RLS policies.

grant usage on schema public to authenticated, service_role;

grant select on public.users to authenticated;

grant all privileges on public.users to service_role;