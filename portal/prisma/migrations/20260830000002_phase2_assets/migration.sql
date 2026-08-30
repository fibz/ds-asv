-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalIdentifier" TEXT NOT NULL,
    "displayName" TEXT,
    "owner" TEXT,
    "environment" TEXT,
    "criticality" TEXT NOT NULL DEFAULT 'medium',
    "lifecycleState" TEXT NOT NULL DEFAULT 'pending_verification',
    "verificationState" TEXT NOT NULL DEFAULT 'unverified',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVerification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "challengeHash" TEXT,
    "verifiedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "summary" JSONB NOT NULL,
    "invalidRows" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_type_idx" ON "Asset"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Asset_organizationId_lifecycleState_idx" ON "Asset"("organizationId", "lifecycleState");

-- CreateIndex
CREATE INDEX "Asset_organizationId_canonicalIdentifier_idx" ON "Asset"("organizationId", "canonicalIdentifier");

-- CreateIndex
CREATE INDEX "AssetVerification_assetId_idx" ON "AssetVerification"("assetId");

-- CreateIndex
CREATE INDEX "AssetVerification_organizationId_idx" ON "AssetVerification"("organizationId");

-- CreateIndex
CREATE INDEX "AssetVerification_status_idx" ON "AssetVerification"("status");

-- CreateIndex
CREATE INDEX "AssetImport_organizationId_idx" ON "AssetImport"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetImport_organizationId_idempotencyKey_key" ON "AssetImport"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVerification" ADD CONSTRAINT "AssetVerification_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVerification" ADD CONSTRAINT "AssetVerification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetImport" ADD CONSTRAINT "AssetImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 2, Task 3: RLS + grants + dedupe index (fail-closed pattern).

ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_tenant_isolation ON "Asset"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "AssetVerification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_verification_tenant_isolation ON "AssetVerification"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "AssetImport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_import_tenant_isolation ON "AssetImport"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Asset" TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AssetVerification" TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AssetImport" TO asv_app;

-- Unique ACTIVE asset: (organizationId, type, canonicalIdentifier). Retired
-- assets are preserved historically, so they may be re-added later; every
-- other lifecycle state participates in dedupe. This is the backstop for
-- service-level dedupe (import races cannot create duplicates).
CREATE UNIQUE INDEX "Asset_active_unique"
  ON "Asset"("organizationId", "type", "canonicalIdentifier")
  WHERE "lifecycleState" <> 'retired';
