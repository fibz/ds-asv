import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getAppMode } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Scan } from "@/lib/generated/prisma";

export class ScanGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const TARGET_TYPES = ["ipv4", "ipv6", "cidr", "fqdn"];
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export async function createScanFromAssets(
  ctx: TenantContext,
  input: { name: string; assetIds: string[] }
): Promise<Scan & { targets: { id: string; assetId: string; type: string; canonicalIdentifier: string; status: string }[] }> {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new ScanGuardError("name must be a non-empty string up to 200 chars");
  if (!Array.isArray(input.assetIds) || input.assetIds.length === 0) throw new ScanGuardError("assetIds must contain at least one asset");
  const prod = getAppMode() === "prod";
  return withTenant(ctx.organizationId, async (tx) => {
    const assets = await tx.asset.findMany({ where: { id: { in: input.assetIds }, organizationId: ctx.organizationId } });
    if (assets.length !== new Set(input.assetIds).size) {
      throw new ScanGuardError("one or more assets not found in this organization");
    }
    for (const a of assets) {
      if (a.lifecycleState === "retired") throw new ScanGuardError(`asset ${a.canonicalIdentifier} is retired`);
      if (prod && a.verificationState !== "verified") {
        throw new ScanGuardError(`asset ${a.canonicalIdentifier} is not verified (required in prod)`);
      }
    }
    const scan = await tx.scan.create({ data: { organizationId: ctx.organizationId, name, requestedById: ctx.userId } });
    for (const a of assets) {
      await tx.scanTarget.create({
        data: { scanId: scan.id, assetId: a.id, organizationId: ctx.organizationId, type: a.type, canonicalIdentifier: a.canonicalIdentifier },
      });
    }
    await recordAudit(ctx, "scan.created", "Scan", scan.id, undefined, { name, targets: assets.map((a) => a.canonicalIdentifier) }, undefined, tx);
    const targets = await tx.scanTarget.findMany({ where: { scanId: scan.id } });
    return { ...scan, targets };
  });
}

export async function listScans(ctx: TenantContext): Promise<(Scan & { targets: unknown[] })[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.scan.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, include: { targets: true } })
  );
}

export async function getScan(ctx: TenantContext, scanId: string): Promise<(Scan & { targets: unknown[]; _count: { findings: number } }) | null> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.scan.findUnique({ where: { id: scanId }, include: { targets: true, _count: { select: { findings: true } } } })
  );
}

export async function transitionScanStatus(
  ctx: TenantContext,
  scanId: string,
  status: "RUNNING" | "COMPLETED" | "FAILED"
): Promise<Scan | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId } });
    if (!scan) return null;
    if (!(VALID_TRANSITIONS[scan.status] ?? []).includes(status)) {
      throw new ScanGuardError(`invalid transition ${scan.status} -> ${status}`);
    }
    const data: Prisma.ScanUpdateInput = { status };
    if (status === "COMPLETED" || status === "FAILED") data.completedAt = new Date();
    const updated = await tx.scan.update({ where: { id: scanId }, data });
    await recordAudit(ctx, "scan.status.updated", "Scan", scanId, { status: scan.status }, { status }, undefined, tx);
    return updated;
  });
}
