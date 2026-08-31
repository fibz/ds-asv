-- DropIndex
DROP INDEX "Session_tokenHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "Session_organizationId_tokenHash_key" ON "Session"("organizationId", "tokenHash");

