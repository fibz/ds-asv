import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import type { TenantContext } from "@/lib/tenant";
import {
  cancelQsaAssignment,
  claimQsaAssignment,
  completeQsaAssignment,
  createQsaAssignment,
  listQsaAssignments,
  listQsaCandidateReports,
  startQsaReview,
  QsaAssignmentConflictError,
  QsaAssignmentGuardError,
} from "./assignment";

const QSA = "qsa_service_test";
const CUSTOMER = "qsa_service_customer";
const USER_1 = "qsa_service_user_1";
const USER_2 = "qsa_service_user_2";
const REPORT_1 = "qsa_service_report_1";
const REPORT_2 = "qsa_service_report_2";

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.ADMIN_DATABASE_URL);
const describeDb = databaseAvailable ? describe : describe.skip;

const ctx: TenantContext = {
  userId: USER_1,
  organizationId: QSA,
  role: "report_viewer",
  isStaff: true,
  appMode: "test",
};
const ctx2: TenantContext = { ...ctx, userId: USER_2 };

async function adminWipe() {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [[QSA, CUSTOMER]]);
    await admin.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [[USER_1, USER_2]]);
  } finally {
    await admin.end();
  }
}

describeDb("QSA assignment lifecycle", () => {
  beforeAll(async () => {
    await adminWipe();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, QSA);
      await tx.organization.create({ data: { id: QSA, name: "QSA Service Test" } });
      await tx.organization.create({ data: { id: CUSTOMER, name: "Service Customer", parentOrgId: QSA } });
      await tx.user.create({ data: { id: USER_1, idpId: USER_1, email: "reviewer1@example.test" } });
      await tx.user.create({ data: { id: USER_2, idpId: USER_2, email: "reviewer2@example.test" } });
      await tx.organizationMembership.createMany({
        data: [
          { userId: USER_1, organizationId: QSA, role: "report_viewer" },
          { userId: USER_2, organizationId: QSA, role: "report_viewer" },
        ],
      });
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, CUSTOMER);
      await tx.scan.create({ data: { id: "qsa_service_scan_1", organizationId: CUSTOMER, name: "Service scan 1", requestedById: USER_1, status: "COMPLETED" } });
      await tx.scan.create({ data: { id: "qsa_service_scan_2", organizationId: CUSTOMER, name: "Service scan 2", requestedById: USER_1, status: "COMPLETED" } });
      await tx.report.create({ data: { id: REPORT_1, scanId: "qsa_service_scan_1", organizationId: CUSTOMER, status: "submitted", summary: {} } });
      await tx.report.create({ data: { id: REPORT_2, scanId: "qsa_service_scan_2", organizationId: CUSTOMER, status: "submitted", summary: {} } });
    });
  });

  it("lists candidates and makes queue claim race-safe", async () => {
    const initialIds = (await listQsaCandidateReports(ctx)).map((row) => row.reportId);
    expect(initialIds).toContain(REPORT_2);
    expect(initialIds).toContain(REPORT_1);
    const created = await createQsaAssignment(ctx, { reportId: REPORT_1, notes: "Review evidence" });
    expect(created.status).toBe("queued");
    const remainingIds = (await listQsaCandidateReports(ctx)).map((row) => row.reportId);
    expect(remainingIds).toContain(REPORT_2);
    expect(remainingIds).not.toContain(REPORT_1);

    const claimed = await claimQsaAssignment(ctx, created.id);
    expect(claimed.assigneeUserId).toBe(USER_1);
    await expect(claimQsaAssignment(ctx2, created.id)).rejects.toBeInstanceOf(QsaAssignmentConflictError);
    expect((await startQsaReview(ctx, created.id)).status).toBe("in_review");
    expect((await completeQsaAssignment(ctx, created.id)).status).toBe("completed");
  });

  it("supports direct assignments and cancellation", async () => {
    const direct = await createQsaAssignment(ctx, { reportId: REPORT_2, assigneeUserId: USER_2, dueAt: new Date(Date.now() + 86_400_000) });
    expect(direct.status).toBe("assigned");
    await expect(startQsaReview(ctx, direct.id)).rejects.toBeInstanceOf(QsaAssignmentConflictError);
    expect((await startQsaReview(ctx2, direct.id)).status).toBe("in_review");
    expect((await cancelQsaAssignment(ctx, direct.id, "Customer withdrew the request")).status).toBe("cancelled");
    expect((await listQsaAssignments(ctx, { status: "cancelled" })).some((row) => row.id === direct.id)).toBe(true);
  });

  it("requires staff identity and validates cancellation reasons", async () => {
    await expect(listQsaAssignments({ ...ctx, isStaff: false })).rejects.toBeInstanceOf(QsaAssignmentGuardError);
    await expect(cancelQsaAssignment(ctx, "missing", "")).rejects.toBeInstanceOf(QsaAssignmentGuardError);
  });

  afterAll(async () => {
    await adminWipe();
    await prisma.$disconnect();
  });
});
