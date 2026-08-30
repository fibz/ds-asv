import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { normalizeIdentifier, isAssetType, type AssetType } from "@/lib/assets/normalize";
import type { TenantContext } from "@/lib/tenant";

export class DuplicateAssetError extends Error {
  constructor(public existingAssetId: string) {
    super(`Asset already exists (id ${existingAssetId})`);
    this.name = "DuplicateAssetError";
  }
}

export interface AssetInput {
  type: string;
  identifier: string;
  displayName?: string;
  owner?: string;
  environment?: string;
  criticality?: string;
}

export interface AssetFilters {
  type?: string;
  lifecycleState?: string;
  criticality?: string;
  search?: string; // matches displayName or canonicalIdentifier (case-insensitive)
}

const CRITICALITIES = ["low", "medium", "high", "critical"];
const ENVIRONMENTS = ["production", "staging", "development", "test", "other"];

function assertAssetInput(input: AssetInput): void {
  if (!isAssetType(input.type)) throw new Error(`Invalid asset type: ${input.type}`);
  if (input.criticality && !CRITICALITIES.includes(input.criticality)) {
    throw new Error(`Invalid criticality: ${input.criticality}`);
  }
  if (input.environment && !ENVIRONMENTS.includes(input.environment)) {
    throw new Error(`Invalid environment: ${input.environment}`);
  }
  // normalize (throws on invalid) — canonicalIdentifier is computed here
  normalizeIdentifier(input.type as AssetType, input.identifier);
}

/** Creates an asset under the tenant. Dedupe: throws DuplicateAssetError on an
 * existing NON-retired asset with the same (org, type, canonicalIdentifier). */
export async function createAsset(ctx: TenantContext, input: AssetInput) {
  assertAssetInput(input);
  const canonicalIdentifier = normalizeIdentifier(input.type as AssetType, input.identifier);
  try {
    return await prisma.$transaction(async (tx) => {
      await setRlsContext(ctx.organizationId, tx);
      const existing = await tx.asset.findFirst({
        where: { organizationId: ctx.organizationId, type: input.type, canonicalIdentifier, lifecycleState: { not: "retired" } },
      });
      if (existing) throw new DuplicateAssetError(existing.id);
      const asset = await tx.asset.create({
        data: {
          organizationId: ctx.organizationId,
          type: input.type,
          canonicalIdentifier,
          displayName: input.displayName ?? null,
          owner: input.owner ?? null,
          environment: input.environment ?? null,
          criticality: input.criticality ?? "medium",
          lifecycleState: "pending_verification",
          verificationState: "unverified",
          source: "manual",
        },
      });
      await recordAudit(ctx, "asset.create", "Asset", asset.id, undefined, { type: asset.type, canonicalIdentifier }, undefined, tx);
      return asset;
    });
  } catch (error) {
    // partial unique index backstop (race): surface as DuplicateAssetError
    if (isUniqueViolation(error)) {
      const existing = await findExisting(ctx, input.type, canonicalIdentifier);
      if (existing) throw new DuplicateAssetError(existing.id);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string } };
  return e?.code === "P2002" || e?.meta?.code === "P2002";
}

async function findExisting(ctx: TenantContext, type: string, canonicalIdentifier: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.asset.findFirst({
      where: { organizationId: ctx.organizationId, type, canonicalIdentifier, lifecycleState: { not: "retired" } },
    });
  });
}

export async function listAssets(ctx: TenantContext, filters: AssetFilters) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const where: Record<string, unknown> = {};
    if (filters.type) where.type = filters.type;
    if (filters.lifecycleState) where.lifecycleState = filters.lifecycleState;
    if (filters.criticality) where.criticality = filters.criticality;
    if (filters.search) {
      where.OR = [
        { displayName: { contains: filters.search, mode: "insensitive" } },
        { canonicalIdentifier: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    return tx.asset.findMany({ where, orderBy: { createdAt: "desc" } });
  });
}

export async function getAsset(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.asset.findFirst({ where: { id, organizationId: ctx.organizationId } });
  });
}

/** Cosmetic + ownership fields only. Canonical identifier/type changes are
 * material changes (design §4 change rules) — done via retire + re-create. */
export async function updateAsset(ctx: TenantContext, id: string, patch: { displayName?: string; owner?: string; environment?: string; criticality?: string }) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.asset.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new Error("Asset not found");
    if (patch.criticality && !CRITICALITIES.includes(patch.criticality)) throw new Error(`Invalid criticality: ${patch.criticality}`);
    if (patch.environment && !ENVIRONMENTS.includes(patch.environment)) throw new Error(`Invalid environment: ${patch.environment}`);
    const updated = await tx.asset.update({
      where: { id },
      data: {
        displayName: patch.displayName !== undefined ? patch.displayName : before.displayName,
        owner: patch.owner !== undefined ? patch.owner : before.owner,
        environment: patch.environment !== undefined ? patch.environment : before.environment,
        criticality: patch.criticality !== undefined ? patch.criticality : before.criticality,
      },
    });
    await recordAudit(ctx, "asset.update", "Asset", id, { displayName: before.displayName, owner: before.owner }, { displayName: updated.displayName, owner: updated.owner }, undefined, tx);
    return updated;
  });
}

/** Transition to retired. NEVER deletes — scope/scan/finding/report/audit
 * history depends on the row (design §4: never hard-delete a referenced asset). */
export async function retireAsset(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.asset.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new Error("Asset not found");
    const updated = await tx.asset.update({ where: { id }, data: { lifecycleState: "retired" } });
    await recordAudit(ctx, "asset.retire", "Asset", id, { lifecycleState: before.lifecycleState }, { lifecycleState: "retired" }, undefined, tx);
    return updated;
  });
}
