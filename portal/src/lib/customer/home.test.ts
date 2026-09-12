import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  organization: { findUnique: vi.fn() },
  asset: { count: vi.fn() },
  scan: { count: vi.fn(), findFirst: vi.fn() },
  report: { count: vi.fn(), findFirst: vi.fn() },
  scopeVersion: { findUnique: vi.fn() },
  auditEvent: { findMany: vi.fn() },
  $executeRawUnsafe: vi.fn(),
};

vi.mock("@/lib/prisma-client", () => ({
  prisma: { $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) },
}));
vi.mock("@/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant")>("@/lib/tenant");
  return { ...actual, setRlsContext: vi.fn(), getParentOrg: vi.fn().mockResolvedValue(null) };
});

import { getCustomerHome } from "./home";
import { setRlsContext } from "@/lib/tenant";

const ctx = { userId: "user-a", organizationId: "org-a", role: "organization_owner" as const, isStaff: false, appMode: "dev" };

describe("getCustomerHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.organization.findUnique.mockResolvedValue({ id: "org-a", name: "Acme" });
    tx.asset.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    tx.scan.count.mockResolvedValue(4);
    tx.scan.findFirst.mockResolvedValue({ id: "scan-a", name: "Weekly", status: "COMPLETED", createdAt: new Date("2026-09-09T00:00:00Z") });
    tx.report.count.mockResolvedValue(1);
    tx.report.findFirst.mockResolvedValue({ id: "report-a", status: "draft", scopeVersionId: null, createdAt: new Date("2026-09-09T00:00:00Z"), attestation: null });
    tx.auditEvent.findMany.mockResolvedValue([{ id: "audit-a", action: "scan.created", resourceType: "Scan", createdAt: new Date("2026-09-09T00:00:00Z") }]);
  });

  it("returns only the current organization view and binds RLS first", async () => {
    const result = await getCustomerHome(ctx);
    expect(setRlsContext).toHaveBeenCalledWith("org-a", tx);
    expect(result.organization).toEqual({ id: "org-a", name: "Acme", parentName: null });
    expect(result.assets).toEqual({ total: 3, verified: 2, pending: 1 });
    expect(result.scans.total).toBe(4);
    expect(result.reports.latest?.isFinal).toBe(false);
    expect(tx.asset.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a" }) }));
    expect(tx.auditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });

  it("returns explicit empty values when the organization has no activity", async () => {
    tx.asset.count.mockReset().mockResolvedValue(0);
    tx.scan.count.mockResolvedValue(0);
    tx.scan.findFirst.mockResolvedValue(null);
    tx.report.count.mockResolvedValue(0);
    tx.report.findFirst.mockResolvedValue(null);
    tx.auditEvent.findMany.mockResolvedValue([]);
    const result = await getCustomerHome(ctx);
    expect(result.assets).toEqual({ total: 0, verified: 0, pending: 0 });
    expect(result.scans.latest).toBeNull();
    expect(result.reports.latest).toBeNull();
    expect(result.activity).toEqual([]);
  });
});
