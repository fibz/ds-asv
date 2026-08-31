-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_organizationId_userId_idx" ON "Session"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Session_organizationId_lastSeenAt_idx" ON "Session"("organizationId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- User center: session registry RLS (fail-closed pattern).
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_tenant_isolation ON "Session"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

-- asv_app can SELECT (list/blocked-check), INSERT + UPDATE (upsert lastSeenAt,
-- set revokedAt). NO DELETE: sessions are revoked, never deleted.
GRANT SELECT, INSERT, UPDATE ON "Session" TO asv_app;
