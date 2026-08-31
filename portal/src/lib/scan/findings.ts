import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { getScan, transitionScanStatus } from "@/lib/scan/service";
import { issueScanManifest, simulatedScanner } from "@/lib/scan/manifest";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export interface FindingIngest {
  assetId: string;
  qid: string;
  cveId?: string | null;
  severity: string;
  pciSeverity?: string;
  title: string;
  description?: string;
  threat?: string;
  impact?: string;
  result?: string;
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

/**
 * Ruling R2 (load-bearing): the manifest carries targets as `{type,
 * canonicalIdentifier}` only (no DB assetId), and the simulated scanner keys
 * findings by `assetId = canonicalIdentifier` (e.g. "10.2.2.2"). A finding's
 * `assetId` may therefore be either the ScanTarget's real DB assetId OR its
 * canonicalIdentifier. Build a lookup keyed by BOTH and resolve each finding
 * to the real ScanTarget.assetId so the stored Finding.assetId is the DB
 * asset id, not the canonical string.
 */
function resolveAssetId(
  scanTargets: { assetId: string; canonicalIdentifier: string }[],
  fAssetId: string
): string {
  const byAssetId = new Map(scanTargets.map((t) => [t.assetId, t.assetId]));
  if (byAssetId.has(fAssetId)) return fAssetId;
  const byCanonical = new Map(scanTargets.map((t) => [t.canonicalIdentifier, t.assetId]));
  const resolved = byCanonical.get(fAssetId);
  if (resolved) return resolved;
  throw new Error(`finding asset ${fAssetId} is not a target of this scan`);
}

export async function ingestFindings(
  ctx: TenantContext,
  scanId: string,
  findings: FindingIngest[]
): Promise<{ count: number }> {
  return withTenant(ctx.organizationId, async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId }, include: { targets: true } });
    if (!scan || scan.organizationId !== ctx.organizationId) throw new Error("Scan not found");
    let count = 0;
    for (const f of findings) {
      const assetId = resolveAssetId(scan.targets, f.assetId);
      if (!/^[1-5]$/.test(f.severity)) throw new Error("severity must be 1-5");
      if (!f.title || !f.qid) throw new Error("qid and title are required");
      const exists = await tx.finding.findUnique({
        where: { scanId_assetId_qid: { scanId, assetId, qid: f.qid } },
      });
      if (exists) continue; // dedupe: re-ingest is a no-op
      await tx.finding.create({
        data: {
          scanId, assetId, organizationId: ctx.organizationId,
          qid: f.qid, cveId: f.cveId ?? null, severity: f.severity, pciSeverity: f.pciSeverity ?? null,
          title: f.title, description: f.description, threat: f.threat, impact: f.impact, result: f.result,
        },
      });
      count += 1;
    }
    if (count > 0) await recordAudit(ctx, "finding.ingested", "Scan", scanId, undefined, { count }, undefined, tx);
    return { count };
  });
}

export async function listFindings(ctx: TenantContext, scanId: string): Promise<unknown[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.finding.findMany({ where: { scanId, organizationId: ctx.organizationId }, orderBy: [{ severity: "desc" }, { qid: "asc" }] })
  );
}

/** Dev/test dispatch: issue manifest → simulated scanner → ingest → complete. */
export async function runScanWithSimulatedScanner(ctx: TenantContext, scanId: string): Promise<{ findings: number }> {
  await transitionScanStatus(ctx, scanId, "RUNNING");
  const { manifest } = await issueScanManifest(ctx, scanId);
  const results = await simulatedScanner(manifest);
  const all = results.flatMap((r) => r.findings);
  const { count } = await ingestFindings(ctx, scanId, all);
  await transitionScanStatus(ctx, scanId, "COMPLETED");
  return { findings: count };
}
