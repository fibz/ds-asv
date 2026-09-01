-- CreateTable
CREATE TABLE "ScopeSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeVersion" (
    "id" TEXT NOT NULL,
    "scopeSetId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "contentHash" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeItem" (
    "id" TEXT NOT NULL,
    "scopeVersionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT,
    "type" TEXT NOT NULL,
    "canonicalIdentifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Authorization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeVersionId" TEXT NOT NULL,
    "statementHash" TEXT NOT NULL,
    "scopeVersionHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "justification" TEXT NOT NULL,
    "resolutionNote" TEXT,
    "raisedById" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScopeSet_organizationId_idx" ON "ScopeSet"("organizationId");

-- CreateIndex
CREATE INDEX "ScopeVersion_organizationId_idx" ON "ScopeVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeVersion_scopeSetId_versionNumber_key" ON "ScopeVersion"("scopeSetId", "versionNumber");

-- CreateIndex
CREATE INDEX "ScopeItem_scopeVersionId_idx" ON "ScopeItem"("scopeVersionId");

-- CreateIndex
CREATE INDEX "ScopeItem_organizationId_idx" ON "ScopeItem"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Authorization_scopeVersionId_key" ON "Authorization"("scopeVersionId");

-- CreateIndex
CREATE INDEX "Authorization_organizationId_idx" ON "Authorization"("organizationId");

-- CreateIndex
CREATE INDEX "Dispute_findingId_idx" ON "Dispute"("findingId");

-- CreateIndex
CREATE INDEX "Dispute_organizationId_idx" ON "Dispute"("organizationId");

-- AddForeignKey
ALTER TABLE "ScopeSet" ADD CONSTRAINT "ScopeSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeVersion" ADD CONSTRAINT "ScopeVersion_scopeSetId_fkey" FOREIGN KEY ("scopeSetId") REFERENCES "ScopeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeVersion" ADD CONSTRAINT "ScopeVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_scopeVersionId_fkey" FOREIGN KEY ("scopeVersionId") REFERENCES "ScopeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Authorization" ADD CONSTRAINT "Authorization_scopeVersionId_fkey" FOREIGN KEY ("scopeVersionId") REFERENCES "ScopeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Authorization" ADD CONSTRAINT "Authorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Phase 4: scope/authorization/dispute RLS (fail-closed pattern).
ALTER TABLE "ScopeSet" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_set_tenant_isolation ON "ScopeSet"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "ScopeVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_version_tenant_isolation ON "ScopeVersion"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "ScopeItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_item_tenant_isolation ON "ScopeItem"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "Authorization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY authorization_tenant_isolation ON "Authorization"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "Dispute" ENABLE ROW LEVEL SECURITY;
CREATE POLICY dispute_tenant_isolation ON "Dispute"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "ScopeSet" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ScopeVersion" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ScopeItem" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Authorization" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Dispute" TO asv_app;
