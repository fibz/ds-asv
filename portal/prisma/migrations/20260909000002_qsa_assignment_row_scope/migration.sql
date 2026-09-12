-- Tighten QSA evidence policies so an active assignment proves the exact
-- report row (and its related scan/scope/finding/dispute), not just a customer
-- organization. This migration is separate so existing installations can
-- receive the row-level correction without resetting their database.
CREATE OR REPLACE FUNCTION public.qsa_assignment_row_access(
  assignment_id text,
  report_id text,
  customer_org_id text,
  qsa_org_id text,
  user_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "QsaAssignment" a
    JOIN "Report" r ON r."id" = a."reportId"
    JOIN "OrganizationMembership" m
      ON m."organizationId" = a."qsaOrganizationId"
     AND m."userId" = user_id
     AND m."status" = 'active'
    WHERE a."id" = assignment_id
      AND a."reportId" = report_id
      AND a."customerOrganizationId" = customer_org_id
      AND r."id" = report_id
      AND r."organizationId" = customer_org_id
      AND a."qsaOrganizationId" = qsa_org_id
      AND a."status" IN ('queued', 'assigned', 'in_review')
      AND (a."assigneeUserId" IS NULL OR a."assigneeUserId" = user_id)
  );
$$;
GRANT EXECUTE ON FUNCTION public.qsa_assignment_row_access(text, text, text, text, text) TO asv_app;

DO $$
DECLARE
  table_name text;
  policy_name text;
  row_expr text;
  policy_expr text;
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
    row_expr := CASE table_name
      WHEN 'Report' THEN 'public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), "Report"."id", "Report"."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true))'
      WHEN 'ReportAttestation' THEN 'public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), "ReportAttestation"."reportId", "ReportAttestation"."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true))'
      WHEN 'Scan' THEN 'EXISTS (SELECT 1 FROM "Report" r WHERE r."scanId" = "Scan"."id" AND public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), r."id", r."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true)))'
      WHEN 'ScanTarget' THEN 'EXISTS (SELECT 1 FROM "Scan" s JOIN "Report" r ON r."scanId" = s."id" WHERE s."id" = "ScanTarget"."scanId" AND public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), r."id", r."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true)))'
      WHEN 'Finding' THEN 'EXISTS (SELECT 1 FROM "Report" r WHERE r."scanId" = "Finding"."scanId" AND public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), r."id", r."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true)))'
      WHEN 'ScopeVersion' THEN 'EXISTS (SELECT 1 FROM "Report" r WHERE r."scopeVersionId" = "ScopeVersion"."id" AND public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), r."id", r."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true)))'
      WHEN 'ScopeItem' THEN 'EXISTS (SELECT 1 FROM "ScopeVersion" sv JOIN "Report" r ON r."scopeVersionId" = sv."id" WHERE sv."id" = "ScopeItem"."scopeVersionId" AND public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), r."id", r."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true)))'
      ELSE 'EXISTS (SELECT 1 FROM "Finding" f JOIN "Report" r ON r."scanId" = f."scanId" WHERE f."id" = "Dispute"."findingId" AND public.qsa_assignment_row_access(current_setting(''app.qsa_assignment_id'', true), r."id", r."organizationId", current_setting(''app.qsa_org_id'', true), current_setting(''app.qsa_user_id'', true)))'
    END;
    policy_expr := format('"%s"."organizationId" = current_setting(''app.tenant_id'', true) AND (COALESCE(current_setting(''app.qsa_assignment_id'', true), '''') = '''' OR %s)', table_name, row_expr);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (%s) WITH CHECK (%s)', policy_name, table_name, policy_expr, policy_expr);
  END LOOP;
END $$;
