-- DropForeignKey
ALTER TABLE "Scan" DROP CONSTRAINT "Scan_orgId_fkey";

-- DropIndex
DROP INDEX "Scan_orgId_idx";

-- DropIndex
DROP INDEX "Scan_status_idx";

-- AlterTable
ALTER TABLE "Scan" DROP COLUMN "orgId",
DROP COLUMN "results",
DROP COLUMN "target",
DROP COLUMN "type",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "manifestExpiresAt" TIMESTAMP(3),
ADD COLUMN     "manifestIssuedAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "organizationId" TEXT NOT NULL,
ADD COLUMN     "requestedById" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "ScanTarget" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalIdentifier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "qid" TEXT NOT NULL,
    "cveId" TEXT,
    "severity" TEXT NOT NULL,
    "pciSeverity" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "threat" TEXT,
    "impact" TEXT,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" JSONB NOT NULL,
    "attestationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAttestation" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewedById" TEXT NOT NULL,
    "reason" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanTarget_scanId_idx" ON "ScanTarget"("scanId");

-- CreateIndex
CREATE INDEX "ScanTarget_organizationId_idx" ON "ScanTarget"("organizationId");

-- CreateIndex
CREATE INDEX "Finding_organizationId_idx" ON "Finding"("organizationId");

-- CreateIndex
CREATE INDEX "Finding_scanId_status_idx" ON "Finding"("scanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_scanId_assetId_qid_key" ON "Finding"("scanId", "assetId", "qid");

-- CreateIndex
CREATE UNIQUE INDEX "Report_attestationId_key" ON "Report"("attestationId");

-- CreateIndex
CREATE INDEX "Report_organizationId_idx" ON "Report"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_scanId_key" ON "Report"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportAttestation_reportId_key" ON "ReportAttestation"("reportId");

-- CreateIndex
CREATE INDEX "ReportAttestation_reportId_idx" ON "ReportAttestation"("reportId");

-- CreateIndex
CREATE INDEX "ReportAttestation_organizationId_idx" ON "ReportAttestation"("organizationId");

-- CreateIndex
CREATE INDEX "Scan_organizationId_idx" ON "Scan"("organizationId");

-- CreateIndex
CREATE INDEX "Scan_organizationId_status_idx" ON "Scan"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanTarget" ADD CONSTRAINT "ScanTarget_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanTarget" ADD CONSTRAINT "ScanTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAttestation" ADD CONSTRAINT "ReportAttestation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAttestation" ADD CONSTRAINT "ReportAttestation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 3: scan-domain RLS (fail-closed pattern).
ALTER TABLE "Scan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_tenant_isolation ON "Scan"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "ScanTarget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_target_tenant_isolation ON "ScanTarget"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "Finding" ENABLE ROW LEVEL SECURITY;
CREATE POLICY finding_tenant_isolation ON "Finding"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_tenant_isolation ON "Report"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "ReportAttestation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_attestation_tenant_isolation ON "ReportAttestation"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "Scan" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ScanTarget" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Finding" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Report" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ReportAttestation" TO asv_app;
