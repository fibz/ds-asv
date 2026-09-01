import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getAppMode } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { listFindings } from "@/lib/scan/findings";
import { resolveReportScopeVersionId } from "@/lib/scan/service";
import { getScopeVersion } from "@/lib/scope/service";
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
    // Phase 5: record the approved scope version that authorizes this scan's
    // scope. Resolved at generation time; on update only when the report has
    // no link yet — never re-point an already-linked (possibly approved) report.
    const scopeVersionId = await resolveReportScopeVersionId(ctx, scanId);
    const report = existing
      ? await tx.report.update({
          where: { id: existing.id },
          data: { summary: summary as unknown as Prisma.InputJsonValue, ...(existing.scopeVersionId == null ? { scopeVersionId } : {}) },
        })
      : await tx.report.create({ data: { scanId, organizationId: ctx.organizationId, status: "draft", summary: summary as unknown as Prisma.InputJsonValue, scopeVersionId } });
    await recordAudit(ctx, "report.generated", "Report", report.id, undefined, summary, undefined, tx);
    return report;
  });
}

export async function getReport(ctx: TenantContext, reportId: string): Promise<(Report & { attestation: unknown }) | null> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.report.findUnique({ where: { id: reportId }, include: { attestation: true } })
  );
}

export async function submitReport(ctx: TenantContext, reportId: string): Promise<Report | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const report = await tx.report.findUnique({ where: { id: reportId } });
    if (!report) return null;
    if (report.status !== "draft") throw new ReportGuardError("only draft reports can be submitted");
    const attestation = await tx.reportAttestation.create({
      data: { reportId, organizationId: ctx.organizationId, status: "submitted", reviewedById: ctx.userId },
    });
    const updated = await tx.report.update({ where: { id: reportId }, data: { status: "submitted", attestationId: attestation.id } });
    await recordAudit(ctx, "report.submitted", "Report", reportId, { status: report.status }, { status: "submitted" }, undefined, tx);
    return updated;
  });
}

export async function attestReport(
  ctx: TenantContext,
  reportId: string,
  opts?: { reason?: string }
): Promise<Report | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const report = await tx.report.findUnique({ where: { id: reportId }, include: { attestation: true } });
    if (!report) return null;
    if (report.status !== "submitted") throw new ReportGuardError("only submitted reports can be attested");
    if (getAppMode() === "prod" && !ctx.isStaff) throw new ReportGuardError("attestation requires a staff reviewer in prod");
    // Phase 5: in prod the attestation gate ALSO requires the report's linked
    // scope version to exist and be approved — a dev-built report with no
    // approved scope authority must never be finalized. (Dev/test: gate
    // relaxed, per Global Constraints.)
    if (getAppMode() === "prod") {
      const scopeV = report.scopeVersionId
        ? (await getScopeVersion(ctx, report.scopeVersionId))
        : null;
      if (!scopeV || scopeV.status !== "approved") {
        throw new ReportGuardError("cannot attest: report has no approved scope version (required in prod)");
      }
    }
    await tx.reportAttestation.update({
      where: { id: report.attestation!.id },
      data: { status: "attested", reason: opts?.reason ?? null, reviewedAt: new Date() },
    });
    const updated = await tx.report.update({ where: { id: reportId }, data: { status: "attested" } });
    await recordAudit(ctx, "report.attested", "Report", reportId, { status: report.status }, { status: "attested" }, opts?.reason, tx);
    return updated;
  });
}

export function isReportFinal(report: {
  status: string;
  scopeVersionId?: string | null;
  approvedScopeVersionId?: string | null;
}): boolean {
  if (report.status !== "attested") return false;
  // Legacy caller (Phase 3 semantics): the caller knows nothing about scope
  // linkage. Attested alone is final. (Real Phase 3 rows carry scopeVersionId:
  // null and no approvedScopeVersionId key.)
  if (report.approvedScopeVersionId === undefined) return true;
  // New-style caller: the report is final only if it recorded an approved
  // scope version AND that recorded version is the approved one.
  if (!report.scopeVersionId) return false;
  return report.scopeVersionId === report.approvedScopeVersionId;
}
