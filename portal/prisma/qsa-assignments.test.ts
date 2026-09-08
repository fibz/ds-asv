import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const QSA = "qsa_schema_test";
const CUSTOMER_A = "qsa_customer_a";
const CUSTOMER_B = "qsa_customer_b";
const QSA_USER = "qsa_schema_user";
const REPORT_A = "qsa_report_a";
const REPORT_A2 = "qsa_report_a2";
const REPORT_B = "qsa_report_b";
const SCAN_A = "qsa_scan_a";
const SCAN_A2 = "qsa_scan_a2";
const SCAN_B = "qsa_scan_b";
const ASSIGNMENT_A = "qsa_assignment_a";
const ASSIGNMENT_HISTORY = "qsa_assignment_history";

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.ADMIN_DATABASE_URL);
const describeDb = databaseAvailable ? describe : describe.skip;

async function withContext<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { qsaOrgId?: string; qsaUserId?: string; assignmentId?: string } = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(tenantId, tx);
    if (opts.qsaOrgId) await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_org_id', $1, true)`, opts.qsaOrgId);
    if (opts.qsaUserId) await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_user_id', $1, true)`, opts.qsaUserId);
    if (opts.assignmentId) await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_assignment_id', $1, true)`, opts.assignmentId);
    return fn(tx);
  });
}

async function adminWipe() {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [[QSA, CUSTOMER_A, CUSTOMER_B]]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [QSA_USER]);
  } finally {
    await admin.end();
  }
}

describeDb("QSA assignment schema and RLS", () => {
  beforeAll(async () => {
    await adminWipe();
    await withContext(QSA, async (tx) => {
      await tx.organization.create({ data: { id: QSA, name: "QSA Test" } });
      await tx.organization.create({ data: { id: CUSTOMER_A, name: "Customer A", parentOrgId: QSA } });
      await tx.organization.create({ data: { id: CUSTOMER_B, name: "Customer B", parentOrgId: QSA } });
      await tx.user.create({ data: { id: QSA_USER, idpId: QSA_USER, email: "qsa@example.test" } });
      await tx.organizationMembership.create({ data: { userId: QSA_USER, organizationId: QSA, role: "report_viewer" } });
    });
    await withContext(CUSTOMER_A, async (tx) => {
      await tx.scan.create({ data: { id: SCAN_A, organizationId: CUSTOMER_A, name: "Scan A", requestedById: QSA_USER, status: "COMPLETED" } });
      await tx.report.create({ data: { id: REPORT_A, scanId: SCAN_A, organizationId: CUSTOMER_A, status: "submitted", summary: {} } });
      await tx.scan.create({ data: { id: SCAN_A2, organizationId: CUSTOMER_A, name: "Scan A2", requestedById: QSA_USER, status: "COMPLETED" } });
      await tx.report.create({ data: { id: REPORT_A2, scanId: SCAN_A2, organizationId: CUSTOMER_A, status: "submitted", summary: {} } });
    });
    await withContext(CUSTOMER_B, async (tx) => {
      await tx.scan.create({ data: { id: SCAN_B, organizationId: CUSTOMER_B, name: "Scan B", requestedById: QSA_USER, status: "COMPLETED" } });
      await tx.report.create({ data: { id: REPORT_B, scanId: SCAN_B, organizationId: CUSTOMER_B, status: "submitted", summary: {} } });
    });
    await withContext(QSA, async (tx) => {
      await tx.qsaAssignment.create({
        data: { id: ASSIGNMENT_A, qsaOrganizationId: QSA, customerOrganizationId: CUSTOMER_A, reportId: REPORT_A, createdByUserId: QSA_USER },
      });
    }, { qsaOrgId: QSA, qsaUserId: QSA_USER });
  });

  it("enforces one active assignment while retaining terminal history", async () => {
    await expect(withContext(QSA, (tx) => tx.qsaAssignment.create({
      data: { id: "qsa_active_duplicate", qsaOrganizationId: QSA, customerOrganizationId: CUSTOMER_A, reportId: REPORT_A, createdByUserId: QSA_USER },
    }), { qsaOrgId: QSA, qsaUserId: QSA_USER })).rejects.toThrow();

    await withContext(QSA, async (tx) => {
      await tx.qsaAssignment.update({ where: { id: ASSIGNMENT_A }, data: { status: "completed", completedAt: new Date() } });
      await tx.qsaAssignment.create({
        data: { id: ASSIGNMENT_HISTORY, qsaOrganizationId: QSA, customerOrganizationId: CUSTOMER_A, reportId: REPORT_A, createdByUserId: QSA_USER },
      });
    }, { qsaOrgId: QSA, qsaUserId: QSA_USER });
    expect(await prisma.qsaAssignment.count({ where: { id: ASSIGNMENT_HISTORY } })).toBe(0);
  });

  it("returns only unassigned submitted reports to the QSA candidate function", async () => {
    const candidates = await withContext(QSA, (tx) => tx.$queryRaw<Array<{ reportId: string }>>`
      SELECT "reportId" FROM public.qsa_list_candidate_reports(${QSA}, ${QSA_USER})
    `, { qsaOrgId: QSA, qsaUserId: QSA_USER });
    expect(candidates.map((row) => row.reportId)).toEqual([REPORT_B, REPORT_A2]);
  });

  it("does not expose another report through an assignment-scoped RLS session", async () => {
    const visible = await withContext(CUSTOMER_A, (tx) => tx.report.findMany(), {
      qsaOrgId: QSA,
      qsaUserId: QSA_USER,
      assignmentId: ASSIGNMENT_HISTORY,
    });
    expect(visible.map((row) => row.id)).toEqual([REPORT_A]);
  });

  afterAll(async () => {
    await adminWipe();
    await prisma.$disconnect();
  });
});
