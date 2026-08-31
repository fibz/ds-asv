import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { listFindings } from "@/lib/scan/findings";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Report } from "@/lib/generated/prisma";

export class ReportGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export async function buildReport(ctx: TenantContext, scanId: string): Promise<Report> {
  return withTenant(ctx.organizationId, async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId } });
    if (!scan || scan.organizationId !== ctx.organizationId) throw new Error("Scan not found");
    if (scan.status !== "COMPLETED") throw new ReportGuardError("report requires a COMPLETED scan");
    const findings = await listFindings(ctx, scanId);
    const bySeverity: Record<string, number> = {};
    const byPci: Record<string, number> = {};
    let total = 0;
    for (const f of findings) {
      const sev = String(f.severity);
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
      if (f.pciSeverity) byPci[f.pciSeverity] = (byPci[f.pciSeverity] ?? 0) + 1;
      total += Number(sev);
    }
    const hosts = new Set(findings.map((f) => f.assetId)).size;
    const averageRisk = findings.length ? Number((total / findings.length).toFixed(2)) : 0;
    const hasCritical = findings.some((f) => Number(f.severity) >= 4);
    const summary = {
      hosts,
      vulnerabilities: findings.length,
      averageRisk,
      bySeverity,
      byPciSeverity: byPci,
      compliance: hasCritical ? "FAILED" : "PASSED",
    };
    const existing = await tx.report.findUnique({ where: { scanId } });
    const report = existing
      ? await tx.report.update({ where: { id: existing.id }, data: { summary: summary as unknown as Prisma.InputJsonValue } })
      : await tx.report.create({ data: { scanId, organizationId: ctx.organizationId, status: "draft", summary: summary as unknown as Prisma.InputJsonValue } });
    await recordAudit(ctx, "report.generated", "Report", report.id, undefined, summary, undefined, tx);
    return report;
  });
}

export async function getReport(ctx: TenantContext, reportId: string): Promise<(Report & { attestation: unknown }) | null> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.report.findUnique({ where: { id: reportId }, include: { attestation: true } })
  );
}
