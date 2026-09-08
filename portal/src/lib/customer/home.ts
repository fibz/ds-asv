import { prisma } from "@/lib/prisma-client";
import { getParentOrg, setRlsContext } from "@/lib/tenant";
import { isReportFinal } from "@/lib/scan/report";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export interface CustomerHomeView {
  organization: { id: string; name: string; parentName: string | null };
  assets: { total: number; verified: number; pending: number };
  scans: { total: number; latest: { id: string; name: string; status: string; createdAt: string } | null };
  reports: { total: number; latest: { id: string; status: string; isFinal: boolean; createdAt: string } | null };
  activity: { id: string; action: string; resourceType: string; createdAt: string }[];
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(organizationId, tx);
    return fn(tx);
  });
}

export function getCustomerHome(ctx: TenantContext): Promise<CustomerHomeView> {
  return withTenant(ctx.organizationId, async (tx) => {
    const [organization, parent, totalAssets, verifiedAssets, pendingAssets, totalScans, latestScan, totalReports, latestReport, activity] = await Promise.all([
      tx.organization.findUnique({ where: { id: ctx.organizationId } }),
      getParentOrg(tx),
      tx.asset.count({ where: { organizationId: ctx.organizationId, lifecycleState: { not: "retired" } } }),
      tx.asset.count({ where: { organizationId: ctx.organizationId, lifecycleState: { not: "retired" }, verificationState: "verified" } }),
      tx.asset.count({ where: { organizationId: ctx.organizationId, lifecycleState: { not: "retired" }, verificationState: { not: "verified" } } }),
      tx.scan.count({ where: { organizationId: ctx.organizationId } }),
      tx.scan.findFirst({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" } }),
      tx.report.count({ where: { organizationId: ctx.organizationId } }),
      tx.report.findFirst({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, include: { attestation: true } }),
      tx.auditEvent.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);
    if (!organization) throw new Error("Organization not found");

    let latestReportView: CustomerHomeView["reports"]["latest"] = null;
    if (latestReport) {
      const scope = latestReport.scopeVersionId
        ? await tx.scopeVersion.findUnique({ where: { id: latestReport.scopeVersionId } })
        : null;
      const approvedScopeVersionId = scope?.status === "approved" ? scope.id : null;
      latestReportView = {
        id: latestReport.id,
        status: latestReport.status,
        isFinal: isReportFinal({
          status: latestReport.status,
          scopeVersionId: latestReport.scopeVersionId,
          approvedScopeVersionId,
        }),
        createdAt: latestReport.createdAt.toISOString(),
      };
    }

    return {
      organization: { id: organization.id, name: organization.name, parentName: parent?.name ?? null },
      assets: { total: totalAssets, verified: verifiedAssets, pending: pendingAssets },
      scans: {
        total: totalScans,
        latest: latestScan ? { id: latestScan.id, name: latestScan.name, status: latestScan.status, createdAt: latestScan.createdAt.toISOString() } : null,
      },
      reports: { total: totalReports, latest: latestReportView },
      activity: activity.map((event) => ({ id: event.id, action: event.action, resourceType: event.resourceType, createdAt: event.createdAt.toISOString() })),
    };
  });
}
