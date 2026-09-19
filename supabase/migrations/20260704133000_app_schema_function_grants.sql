-- ============================================================
-- TaxDesk OS - app schema function grants
--
-- Mutable tables use trigger functions in schema app (for example
-- app.set_updated_at). service_role bypasses RLS, but it still needs
-- ordinary schema/function privileges when those triggers execute.
-- anon remains without access.
-- ============================================================

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

alter default privileges for role postgres in schema app
  grant execute on functions to authenticated, service_role;
