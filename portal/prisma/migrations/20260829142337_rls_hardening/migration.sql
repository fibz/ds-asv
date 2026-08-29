-- Task 3 follow-up: security-review fixes.
--
-- 1) Organization parent-chain read (Finding 1): a SECURITY DEFINER helper
--    `get_org_parent()` lets a child tenant read its parent org row. It reads
--    ONLY the RLS session variable `app.tenant_id` -- it takes no parameters --
--    so it cannot be pointed at an arbitrary org and cannot become a
--    cross-tenant read channel. (A same-table EXISTS subquery inside a plain
--    policy hits PostgreSQL's "infinite recursion detected in policy" guard,
--    which is why a definer function is used.)
--
-- 2) Fail-closed grants (Finding 2): asv_app no longer has blanket DML on
--    every table. It is granted DML only on the 4 RLS-protected tenant tables,
--    plus the minimum User access (SELECT for the FK check on
--    OrganizationMembership.userId; INSERT for identity provisioning by the
--    app/tests). ApiKey/Scan/Compliance/WafConfig/SiemAlert get NO grants until
--    their RLS policies land (Tasks 6-7). `_prisma_migrations` is excluded.

-- ---------------------------------------------------------------------------
-- 1) get_org_parent(): returns the parent org row of the org named by
--    app.tenant_id, or no rows when unset / tenant has no parent.
--    SECURITY DEFINER (owner = migration role `asv`, a superuser, so RLS is
--    bypassed inside the function body); search_path is pinned to prevent
--    definer-function hijacking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_parent()
RETURNS SETOF public."Organization"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public."Organization"
  WHERE id = (
    SELECT "parentOrgId" FROM public."Organization"
    WHERE id = current_setting('app.tenant_id', true)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_org_parent() TO asv_app;

-- ---------------------------------------------------------------------------
-- 2) Fail-closed grants.
-- ---------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM asv_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON "Organization" TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrganizationMembership" TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Contact" TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditEvent" TO asv_app;
-- User: SELECT is required for the OrganizationMembership FK check; INSERT is
-- required for identity provisioning (IdP sync, Task 4). DELETE withheld.
GRANT SELECT, INSERT ON "User" TO asv_app;

-- Undo the blanket default privileges from the first RLS migration so tables
-- created by later migrations start fail-closed. Pattern going forward: each
-- migration that adds a tenant table must enable RLS, add its policies, and
-- GRANT the table to asv_app -- all in the same migration.
ALTER DEFAULT PRIVILEGES FOR ROLE asv IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM asv_app;
