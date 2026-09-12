-- Expose only the QSA review status for a customer's own report.
-- The SECURITY DEFINER function is intentionally parameterized by report id
-- only; the tenant is always derived from the transaction-local RLS context.
CREATE OR REPLACE FUNCTION public.customer_report_assignment_statuses(p_report_ids text[])
RETURNS TABLE(
  "reportId" text,
  "status" text,
  "updatedAt" timestamp,
  "completedAt" timestamp
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ranked."reportId", ranked."status", ranked."updatedAt", ranked."completedAt"
  FROM (
    SELECT
      a."reportId",
      a."status",
      a."updatedAt",
      a."completedAt",
      row_number() OVER (
        PARTITION BY a."reportId"
        ORDER BY
          CASE WHEN a."status" IN ('queued', 'assigned', 'in_review') THEN 0 ELSE 1 END,
          a."updatedAt" DESC
      ) AS row_number
    FROM "QsaAssignment" a
    JOIN "Report" r ON r."id" = a."reportId"
    WHERE a."reportId" = ANY(p_report_ids)
      AND r."organizationId" = current_setting('app.tenant_id', true)
  ) ranked
  WHERE ranked.row_number = 1;
$$;

GRANT EXECUTE ON FUNCTION public.customer_report_assignment_statuses(text[]) TO asv_app;
