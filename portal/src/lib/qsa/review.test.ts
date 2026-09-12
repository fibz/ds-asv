import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { getQsaReview, attestAssignedReport, moderateAssignedDispute } from "./review";
import { createQsaAssignment, completeQsaAssignment } from "./assignment";
import type { TenantContext } from "@/lib/tenant";

const QSA = "qsa_review_test";
const CUSTOMER = "qsa_review_customer";
const USER_1 = "qsa_review_user_1";
const USER_2 = "qsa_review_user_2";
const SCAN = "qsa_review_scan";
const TARGET = "qsa_review_target";
const REPORT = "qsa_review_report";
const ATTESTATION = "qsa_review_attestation";
const FINDING = "qsa_review_finding";
const DISPUTE = "qsa_review_dispute";

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.ADMIN_DATABASE_URL);
const describeDb = databaseAvailable ? describe : describe.skip;
const ctx: TenantContext = { userId: USER_1, organizationId: QSA, role: "report_viewer", isStaff: true, appMode: "test" };
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

describeDb("assignment-scoped QSA review", () => {
  let assignmentId = "";

  beforeAll(async () => {
    await adminWipe();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, QSA);
      await tx.organization.create({ data: { id: QSA, name: "QSA Review Test" } });
      await tx.organization.create({ data: { id: CUSTOMER, name: "Review Customer", parentOrgId: QSA } });
      await tx.user.create({ data: { id: USER_1, idpId: USER_1, email: "review1@example.test" } });
      await tx.user.create({ data: { id: USER_2, idpId: USER_2, email: "review2@example.test" } });
      await tx.organizationMembership.createMany({ data: [
        { userId: USER_1, organizationId: QSA, role: "report_viewer" },
        { userId: USER_2, organizationId: QSA, role: "report_viewer" },
      ] });
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, CUSTOMER);
      await tx.scan.create({ data: { id: SCAN, organizationId: CUSTOMER, name: "Review scan", requestedById: USER_1, status: "COMPLETED" } });
      await tx.scanTarget.create({ data: { id: TARGET, scanId: SCAN, assetId: "asset-review", organizationId: CUSTOMER, type: "fqdn", canonicalIdentifier: "review.example.test" } });
      await tx.finding.create({ data: { id: FINDING, scanId: SCAN, assetId: "asset-review", organizationId: CUSTOMER, qid: "QSA-1", severity: "4", title: "Review finding" } });
      await tx.report.create({ data: { id: REPORT, scanId: SCAN, organizationId: CUSTOMER, status: "submitted", summary: { vulnerabilities: 1 } } });
      await tx.reportAttestation.create({ data: { id: ATTESTATION, reportId: REPORT, organizationId: CUSTOMER, status: "submitted", reviewedById: USER_1 } });
      await tx.report.update({ where: { id: REPORT }, data: { attestationId: ATTESTATION } });
      await tx.dispute.create({ data: { id: DISPUTE, findingId: FINDING, organizationId: CUSTOMER, justification: "Needs review", raisedById: USER_1 } });
    });
    const assignment = await createQsaAssignment(ctx, { reportId: REPORT, assigneeUserId: USER_1 });
    assignmentId = assignment.id;
  });

  it("loads only the assigned report evidence", async () => {
    const view = await getQsaReview(ctx, assignmentId);
    expect(view?.customer.id).toBe(CUSTOMER);
    expect(view?.report.id).toBe(REPORT);
    expect(view?.scan.targets).toHaveLength(1);
    expect(view?.findings).toHaveLength(1);
    expect(view?.disputes).toHaveLength(1);
    expect(await getQsaReview(ctx2, assignmentId)).toBeNull();
  });

  it("uses the existing attestation and dispute gates", async () => {
    const afterAttest = await attestAssignedReport(ctx, assignmentId, "QSA reviewed evidence");
    expect(afterAttest?.report.status).toBe("attested");
    const afterModeration = await moderateAssignedDispute(ctx, assignmentId, DISPUTE, { status: "resolved", note: "Confirmed" });
    expect(afterModeration?.disputes[0]).toMatchObject({ status: "resolved", resolutionNote: "Confirmed" });
    expect(afterModeration?.isFinal).toBe(false);
  });

  it("hides review data after assignment completion", async () => {
    expect((await completeQsaAssignment(ctx, assignmentId)).status).toBe("completed");
    expect(await getQsaReview(ctx, assignmentId)).toBeNull();
  });

  afterAll(async () => {
    await adminWipe();
    await prisma.$disconnect();
  });
});
