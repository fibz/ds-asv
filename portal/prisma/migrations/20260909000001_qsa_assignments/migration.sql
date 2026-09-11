-- QSA assignment records are owned by a QSA organization and point to one
-- customer report. Historical terminal rows remain; only active rows are
-- unique per report.
CREATE TABLE "QsaAssignment" (
  "id" TEXT NOT NULL,
  "qsaOrganizationId" TEXT NOT NULL,
  "customerOrganizationId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "assigneeUserId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "createdByUserId" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3),
  "notes" TEXT,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QsaAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QsaAssignment_qsaOrganizationId_fkey" FOREIGN KEY ("qsaOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QsaAssignment_customerOrganizationId_fkey" FOREIGN KEY ("customerOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QsaAssignment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QsaAssignment_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "QsaAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "QsaAssignment_qsaOrganizationId_status_idx" ON "QsaAssignment"("qsaOrganizationId", "status");
CREATE INDEX "QsaAssignment_assigneeUserId_status_idx" ON "QsaAssignment"("assigneeUserId", "status");
CREATE INDEX "QsaAssignment_reportId_idx" ON "QsaAssignment"("reportId");
CREATE UNIQUE INDEX "QsaAssignment_active_report_key"
  ON "QsaAssignment"("reportId")
  WHERE "status" IN ('queued', 'assigned', 'in_review');

ALTER TABLE "QsaAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY qsa_assignment_org_isolation ON "QsaAssignment"
  USING ("qsaOrganizationId" = current_setting('app.qsa_org_id', true))
  WITH CHECK ("qsaOrganizationId" = current_setting('app.qsa_org_id', true));
GRANT SELECT, INSERT, UPDATE ON "QsaAssignment" TO asv_app;

-- This helper is intentionally parameterized only by server-bound session
-- values. It proves the QSA membership and assignment state without exposing
-- a general cross-tenant lookup primitive to the application role.
CREATE OR REPLACE FUNCTION public.qsa_assignment_access(assignment_id text, qsa_org_id text, user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "QsaAssignment" a
    JOIN "OrganizationMembership" m
      ON m."organizationId" = a."qsaOrganizationId"
     AND m."userId" = user_id
     AND m."status" = 'active'
    WHERE a."id" = assignment_id
      AND a."qsaOrganizationId" = qsa_org_id
      AND a."status" IN ('queued', 'assigned', 'in_review')
      AND (a."assigneeUserId" IS NULL OR a."assigneeUserId" = user_id)
  );
$$;
GRANT EXECUTE ON FUNCTION public.qsa_assignment_access(text, text, text) TO asv_app;

CREATE OR REPLACE FUNCTION public.qsa_list_candidate_reports(qsa_org_id text, user_id text)
RETURNS TABLE("reportId" text, "customerOrganizationId" text, "customerName" text, "reportStatus" text, "createdAt" timestamp)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r."id", r."organizationId", o."name", r."status", r."createdAt"
  FROM "Report" r
  JOIN "Organization" o ON o."id" = r."organizationId"
  JOIN "OrganizationMembership" m
    ON m."organizationId" = qsa_org_id
   AND m."userId" = user_id
   AND m."status" = 'active'
  WHERE r."status" = 'submitted'
    AND NOT EXISTS (
      SELECT 1 FROM "QsaAssignment" a
      WHERE a."reportId" = r."id"
        AND a."status" IN ('queued', 'assigned', 'in_review')
    )
  ORDER BY r."createdAt" DESC;
$$;
GRANT EXECUTE ON FUNCTION public.qsa_list_candidate_reports(text, text) TO asv_app;

-- Assignment-aware policies are additional gates. Ordinary customer access
-- still uses app.tenant_id when no QSA assignment session is present; a QSA
-- transaction must prove the active assignment before it can read/write rows.
DO $$
DECLARE
  table_name text;
  policy_name text;
  policy_expr text := '"organizationId" = current_setting(''app.tenant_id'', true) AND (COALESCE(current_setting(''app.qsa_assignment_id'', true), '''') = '''' OR public.qsa_assignment_access(current_setting(''app.qsa_assignment_id'', true), current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true)))';
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Report','ReportAttestation','Scan','ScanTarget','Finding','ScopeVersion','ScopeItem','Dispute'] LOOP
    policy_name := CASE table_name
      WHEN 'Report' THEN 'report_tenant_isolation'
      WHEN 'ReportAttestation' THEN 'report_attestation_tenant_isolation'
      WHEN 'Scan' THEN 'scan_tenant_isolation'
      WHEN 'ScanTarget' THEN 'scan_target_tenant_isolation'
      WHEN 'Finding' THEN 'finding_tenant_isolation'
      WHEN 'ScopeVersion' THEN 'scope_version_tenant_isolation'
      WHEN 'ScopeItem' THEN 'scope_item_tenant_isolation'
      ELSE 'dispute_tenant_isolation'
    END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (%s) WITH CHECK (%s)', policy_name, table_name, policy_expr, policy_expr);
  END LOOP;
END $$;
