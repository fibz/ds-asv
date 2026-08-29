-- Task 6: single-use, expiring membership invitations.
--
-- The Invitation table is a tenant table, so it follows the Task 3 pattern:
-- ENABLE ROW LEVEL SECURITY + tenant isolation policy + asv_app grants all in
-- the SAME migration. Default privileges for future tables are revoked
-- (fail-closed), so without this GRANT every runtime query as asv_app would
-- fail with permission denied.

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: invitation_tenant_isolation — plain organizationId = session tenant,
-- both directions. The inviter's org is the tenant that owns the invitation.
-- ---------------------------------------------------------------------------
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitation_tenant_isolation ON "Invitation"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- RLS: invitation_bootstrap — FOR SELECT only, scoped to the presented token
-- hash. Mirrors the membership_bootstrap pattern (Task 3): the ACCEPTOR has no
-- membership yet (that is the point of accepting), so no tenant context exists
-- when the invitation row must be looked up by token. The only capability the
-- acceptor possesses is the invitation token itself; this policy keys the read
-- on its SHA-256 hash (256 bits of entropy — the hash is unguessable and is
-- the token's capability). The app sets `app.invitation_token_hash` ONLY from
-- the user-presented token inside acceptInvitation's transaction. After the
-- lookup, acceptInvitation binds the tenant context to the invitation's org
-- for the membership INSERT + invitation UPDATE. Writes are still gated by
-- invitation_tenant_isolation (WITH CHECK) and membership_tenant_isolation.
-- ---------------------------------------------------------------------------
CREATE POLICY invitation_bootstrap ON "Invitation"
  FOR SELECT
  USING ("tokenHash" = current_setting('app.invitation_token_hash', true));

-- ---------------------------------------------------------------------------
-- Grants (fail-closed): the minimum asv_app needs. SELECT for lookup/verify,
-- INSERT for createInvitation, UPDATE for marking acceptedAt on accept.
-- DELETE withheld — invitation cleanup is a migration/admin concern.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "Invitation" TO asv_app;
