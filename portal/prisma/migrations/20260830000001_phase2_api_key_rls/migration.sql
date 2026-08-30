-- Phase 2, Task 1: ApiKey RLS + grants (fail-closed pattern).
-- Previously deferred: asv_app had NO grants on "ApiKey", and the v1
-- api-keys routes answered 501. This migration enables tenant isolation and
-- grants DML, plus a bootstrap SELECT path for machine-key auth.

ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: an ApiKey row is visible/mutable only by its owning org.
CREATE POLICY api_key_tenant_isolation ON "ApiKey"
  USING ("orgId" = current_setting('app.tenant_id', true))
  WITH CHECK ("orgId" = current_setting('app.tenant_id', true));

-- Bootstrap SELECT for machine auth (X-API-Key): requireScope() must find the
-- candidate key BEFORE any tenant context exists. The caller sets the
-- TRANSACTION-scoped flag app.api_key_lookup='1' around its candidate scan;
-- the flag is set only by the auth gate, never by tenant code. SELECT only —
-- writes still require a tenant context via the isolation policy above.
CREATE POLICY api_key_lookup_bootstrap ON "ApiKey"
  FOR SELECT
  USING (current_setting('app.api_key_lookup', true) = '1');

GRANT SELECT, INSERT, UPDATE, DELETE ON "ApiKey" TO asv_app;
