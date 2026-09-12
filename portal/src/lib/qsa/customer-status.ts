import { prisma } from "@/lib/prisma-client";
import { setRlsContext, type TenantContext } from "@/lib/tenant";
import { Prisma } from "@/lib/generated/prisma";

export type CustomerQsaStatus = "queued" | "assigned" | "in_review" | "completed" | "cancelled";

export interface CustomerReportQsaStatus {
  reportId: string;
  status: CustomerQsaStatus;
  updatedAt: string;
  completedAt: string | null;
}

type RawCustomerReportQsaStatus = {
  reportId: string;
  status: string;
  updatedAt: Date;
  completedAt: Date | null;
};

const CUSTOMER_QSA_STATUSES = new Set<CustomerQsaStatus>([
  "queued",
  "assigned",
  "in_review",
  "completed",
  "cancelled",
]);

function serialize(row: RawCustomerReportQsaStatus): CustomerReportQsaStatus {
  if (!CUSTOMER_QSA_STATUSES.has(row.status as CustomerQsaStatus)) {
    throw new Error(`Unknown QSA assignment status: ${row.status}`);
  }
  return {
    reportId: row.reportId,
    status: row.status as CustomerQsaStatus,
    updatedAt: new Date(row.updatedAt).toISOString(),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
  };
}

export async function listCustomerReportQsaStatuses(
  ctx: TenantContext,
  reportIds: string[],
): Promise<Map<string, CustomerReportQsaStatus>> {
  const ids = [...new Set(reportIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return new Map();

  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const rows = await tx.$queryRaw<RawCustomerReportQsaStatus[]>`
      SELECT "reportId", "status", "updatedAt", "completedAt"
      FROM public.customer_report_assignment_statuses(ARRAY[${Prisma.join(ids)}]::text[])
    `;
    return new Map(rows.map((row) => {
      const status = serialize(row);
      return [status.reportId, status] as const;
    }));
  });
}

export const customerQsaStatusLabel = (status: CustomerQsaStatus | null): string => {
  switch (status) {
    case "queued": return "Awaiting QSA review";
    case "assigned": return "Assigned to a QSA";
    case "in_review": return "Under QSA review";
    case "completed": return "QSA review completed";
    case "cancelled": return "QSA assignment cancelled";
    default: return "Not assigned";
  }
};
