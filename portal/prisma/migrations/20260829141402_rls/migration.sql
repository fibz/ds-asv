-- Task 3: Row-level security + tenant isolation.
--
-- RLS bootstrap: the application must NEVER connect as the table owner.
-- `asv` is a superuser with BYPASSRLS (verified: rolsuper=t), and superusers
-- bypass row-level security unconditionally -- even with FORCE ROW LEVEL
-- SECURITY -- so RLS is inert for any connection made as `asv`.
--
-- Solution: a dedicated application role `asv_app` (LOGIN, NOSUPERUSER,
-- NOBYPASSRLS, non-owner) that all tenant DML runs as. RLS applies to it
-- automatically (non-owners are subject to policies; no FORCE needed). The
-- migration/admin role `asv` keeps full DDL privileges for prisma migrate.
--
-- Connection split (see portal/.env):
--   DATABASE_URL      = postgresql://asv_app:asv@...  (app + tests, subject to RLS)
--   ADMIN_DATABASE_URL = postgresql://asv:CHANGE_ME@...      (prisma CLI / migrate only)

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'asv_app') THEN
    CREATE ROLE asv_app LOGIN PASSWORD 'CHANGE_ME' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO asv_app;
-- tables created by later migrations (as `asv`) are granted to asv_app automatically
ALTER DEFAULT PRIVILEGES FOR ROLE asv IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO asv_app;

-- ---------------------------------------------------------------------------
-- Organization: the tenant boundary itself. It has no organizationId column --
-- it IS the tenant -- so the policy matches on `id` (own org row) plus
-- `parentOrgId` (direct children: QSA -> merchants). WITH CHECK gates writes:
-- an org row can only be created/updated when it is the session tenant itself
-- or a direct child of it. NOTE: a naive same-table EXISTS subquery to also
-- read the PARENT org row hits PostgreSQL's "infinite recursion detected in
-- policy" guard (verified), so parent-row reads are out of scope of this
-- policy and must be served by a dedicated org-tree helper if required.
-- ---------------------------------------------------------------------------
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_tenant_isolation ON "Organization"
  USING (id = current_setting('app.tenant_id', true)
         OR "parentOrgId" = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true)
              OR "parentOrgId" = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- OrganizationMembership: tenant-scoped for all DML, plus a bootstrap SELECT
-- path keyed on app.user_id so resolveTenantContext() can discover the tenant
-- BEFORE any tenant context exists (chicken-and-egg of the plan's interface:
-- the membership read must not require app.tenant_id). The bootstrap policy is
-- FOR SELECT only; writes still require a tenant context.
-- ---------------------------------------------------------------------------
ALTER TABLE "OrganizationMembership" ENABLE ROW LEVEL SECURITY;

CREATE POLICY membership_tenant_isolation ON "OrganizationMembership"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

CREATE POLICY membership_bootstrap ON "OrganizationMembership"
  FOR SELECT
  USING ("userId" = current_setting('app.user_id', true));

-- ---------------------------------------------------------------------------
-- Contact / AuditEvent: plain organizationId = session tenant, both directions.
-- ---------------------------------------------------------------------------
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_tenant_isolation ON "Contact"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_event_tenant_isolation ON "AuditEvent"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
