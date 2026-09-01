import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, ScopeSet, ScopeVersion, ScopeItem } from "@/lib/generated/prisma";

export class ScopeGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

/** Deterministic content hash over a version's items: sorted by canonicalIdentifier. */
export function scopeContentHash(items: { type: string; canonicalIdentifier: string }[]): string {
  const lines = items.map((i) => `${i.type}:${i.canonicalIdentifier}`).sort();
  return createHash("sha256").update(`${items.length}\n${lines.join("\n")}`).digest("hex");
}

export async function createScopeSet(ctx: TenantContext, input: { name: string; description?: string }): Promise<ScopeSet> {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new ScopeGuardError("name must be a non-empty string up to 200 chars");
  return withTenant(ctx.organizationId, async (tx) => {
    const set = await tx.scopeSet.create({ data: { organizationId: ctx.organizationId, name, description: input.description ?? null } });
    await recordAudit(ctx, "scope.set.created", "ScopeSet", set.id, undefined, { name }, undefined, tx);
    return set;
  });
}

export async function createScopeVersion(
  ctx: TenantContext,
  scopeSetId: string,
  input: { assetIds: string[] }
): Promise<ScopeVersion & { items: ScopeItem[] }> {
  if (!Array.isArray(input.assetIds) || input.assetIds.length === 0) {
    throw new ScopeGuardError("assetIds must contain at least one asset");
  }
  return withTenant(ctx.organizationId, async (tx) => {
    const set = await tx.scopeSet.findUnique({ where: { id: scopeSetId } });
    if (!set) throw new ScopeGuardError("Scope set not found");
    const assets = await tx.asset.findMany({ where: { id: { in: input.assetIds }, organizationId: ctx.organizationId } });
    // exact set match (org-scoped) — missing/foreign assets rejected up front
    if (assets.length !== new Set(input.assetIds).size) throw new ScopeGuardError("one or more assets not found in this organization");
    const inScope = assets.filter((a) => a.lifecycleState !== "retired");
    const last = await tx.scopeVersion.findFirst({ where: { scopeSetId }, orderBy: { versionNumber: "desc" } });
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    const items = inScope.map((a) => ({ assetId: a.id, type: a.type, canonicalIdentifier: a.canonicalIdentifier }));
    const contentHash = scopeContentHash(items);
    const version = await tx.scopeVersion.create({
      data: { scopeSetId, organizationId: ctx.organizationId, versionNumber, status: "draft", contentHash },
    });
    for (const it of items) {
      await tx.scopeItem.create({
        data: { scopeVersionId: version.id, organizationId: ctx.organizationId, assetId: it.assetId, type: it.type, canonicalIdentifier: it.canonicalIdentifier },
      });
    }
    await recordAudit(ctx, "scope.version.created", "ScopeVersion", version.id, undefined, { versionNumber, items: inScope.map((a) => a.canonicalIdentifier) }, undefined, tx);
    const created = await tx.scopeVersion.findUnique({ where: { id: version.id }, include: { items: true } });
    return created!;
  });
}

export async function submitScopeVersion(ctx: TenantContext, versionId: string): Promise<ScopeVersion | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const version = await tx.scopeVersion.findUnique({ where: { id: versionId } });
    if (!version) return null;
    if (version.status !== "draft") throw new ScopeGuardError("only draft scope versions can be submitted");
    const updated = await tx.scopeVersion.update({
      where: { id: versionId },
      data: { status: "submitted", submittedById: ctx.userId, submittedAt: new Date() },
    });
    await recordAudit(ctx, "scope.version.submitted", "ScopeVersion", versionId, { status: "draft" }, { status: "submitted" }, undefined, tx);
    return updated;
  });
}

export async function approveScopeVersion(ctx: TenantContext, versionId: string): Promise<ScopeVersion | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const version = await tx.scopeVersion.findUnique({ where: { id: versionId } });
    if (!version) return null;
    if (version.status !== "submitted") throw new ScopeGuardError("only submitted scope versions can be approved");
    const updated = await tx.scopeVersion.update({
      where: { id: versionId },
      data: { status: "approved", approvedById: ctx.userId, approvedAt: new Date() },
    });
    await recordAudit(ctx, "scope.version.approved", "ScopeVersion", versionId, { status: "submitted" }, { status: "approved" }, undefined, tx);
    return updated;
  });
}

export async function listScopeSets(ctx: TenantContext): Promise<ScopeSet[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.scopeSet.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, include: { versions: { orderBy: { versionNumber: "desc" } } } })
  );
}

export async function getScopeVersion(ctx: TenantContext, versionId: string): Promise<(ScopeVersion & { items: ScopeItem[] }) | null> {
  return withTenant(ctx.organizationId, (tx) => tx.scopeVersion.findUnique({ where: { id: versionId }, include: { items: true } }));
}

/**
 * True iff the asset is a ScopeItem of the latest approved version of at least
 * one scope set in the org. Semantics: a later approved version supersedes
 * earlier ones, so an asset that only appears in an OLDER approved version
 * (e.g. removed from the newest approved version of every set) is OUT of
 * approved scope. This keeps the prod scan gate anchored to the defensible
 * current scope snapshot (spec §5.5) rather than any historical one — the
 * property that distinguishes the gate from a plain port scanner's
 * "was ever in scope" check.
 */
export async function assetInApprovedScope(ctx: TenantContext, assetId: string): Promise<boolean> {
  return withTenant(ctx.organizationId, async (tx) => {
    // Approved versions, latest first within each scope set (and RLS-bound on
    // the tx client via the outer withTenant).
    const approved = await tx.scopeVersion.findMany({
      where: { organizationId: ctx.organizationId, status: "approved" },
      include: { items: { where: { assetId } } },
      orderBy: [{ scopeSetId: "asc" }, { versionNumber: "desc" }],
    });
    // Keep only the latest approved version per scope set (its first occurrence
    // in the sorted list); older approved versions of the same set are
    // superseded and must not keep assets in scope.
    const seen = new Set<string>();
    for (const version of approved) {
      if (seen.has(version.scopeSetId)) continue;
      seen.add(version.scopeSetId);
      if (version.items.length > 0) return true;
    }
    return false;
  });
}