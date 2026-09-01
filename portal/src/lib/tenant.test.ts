import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import {
  resolveTenantContext,
  setRlsContext,
  getAppMode,
  getParentOrg,
  isRole,
  tenantContextFromRequest,
} from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

// Mock jose so the request-path staff tests drive verifyToken with fixed
// claims instead of touching a real Keycloak issuer.
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// Fixed ids make re-runs idempotent and the isolation assertions deterministic.
const ORG_A = "org_aaaa_0001";
const ORG_B = "org_bbbb_0002";
const ORG_A_CHILD = "org_cccc_0003";
const USER_A = "user_aaaa_0001";
const USER_B = "user_bbbb_0002";

/**
 * Runs `fn` on a dedicated transaction connection with the RLS tenant context set.
 *
 * `set_config('app.tenant_id', $1, true)` is TRANSACTION-scoped: outside an
 * explicit transaction the value reverts as soon as the statement commits
 * (verified against the live DB), and Prisma's pooled client does not guarantee
 * that a later query reuses the same connection. `prisma.$transaction` pins all
 * `tx.*` calls to one connection, so the context is guaranteed to be visible to
 * every query inside `fn`.
 */
function withTenant<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(organizationId, tx);
    return fn(tx);
  });
}

/** Context-scoped teardown: RLS hides tenant-table rows from uncontexted DELETEs. */
async function wipeTenant(organizationId: string): Promise<void> {
  await withTenant(organizationId, async (tx) => {
    await tx.contact.deleteMany({ where: { organizationId } });
    await tx.organizationMembership.deleteMany({ where: { organizationId } });
    await tx.organization.deleteMany({ where: { id: organizationId } });
  });
}

/**
 * User-row lifecycle must run as the ADMIN role: asv_app has no DELETE on
 * "User" (fail-closed grant surface) and RLS context is irrelevant there.
 */
async function adminQuery(sql: string, params?: unknown[]): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(sql, params);
  } finally {
    await admin.end();
  }
}

function adminDeleteUsers(ids: string[]): Promise<void> {
  return adminQuery(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [ids]);
}

describe("tenant context + row-level security", () => {
  beforeAll(async () => {
    // wipe any leftovers from a previous run
    await wipeTenant(ORG_A_CHILD);
    await wipeTenant(ORG_A);
    await wipeTenant(ORG_B);
    await adminDeleteUsers([USER_A, USER_B]);

    // seed tenant A and tenant B (org + user + membership + contact each)
    await withTenant(ORG_A, async (tx) => {
      await tx.organization.create({ data: { id: ORG_A, name: "Tenant A" } });
      await tx.user.create({ data: { id: USER_A, idpId: "kc-user-a", email: "a@a.com" } });
      await tx.organizationMembership.create({
        data: { userId: USER_A, organizationId: ORG_A, role: "organization_owner" },
      });
      await tx.contact.create({
        data: { organizationId: ORG_A, type: "business", name: "A-contact", email: "a@a.com" },
      });
    });
    await withTenant(ORG_B, async (tx) => {
      await tx.organization.create({ data: { id: ORG_B, name: "Tenant B" } });
      await tx.user.create({ data: { id: USER_B, idpId: "kc-user-b", email: "b@b.com" } });
      await tx.organizationMembership.create({
        data: { userId: USER_B, organizationId: ORG_B, role: "security_admin" },
      });
      await tx.contact.create({
        data: { organizationId: ORG_B, type: "business", name: "B-contact", email: "b@b.com" },
      });
    });
    // QSA flow: tenant A creates a child org (parentOrgId = tenant) — WITH CHECK
    await withTenant(ORG_A, async (tx) => {
      await tx.organization.create({
        data: { id: ORG_A_CHILD, name: "A-child", parentOrgId: ORG_A },
      });
    });
  });

  afterAll(async () => {
    await wipeTenant(ORG_A_CHILD);
    await wipeTenant(ORG_A);
    await wipeTenant(ORG_B);
    await adminDeleteUsers([USER_A, USER_B]);
    await prisma.$disconnect();
  });

  it("exposes the app mode from the environment", () => {
    expect(getAppMode()).toBe("dev");
  });

  it("resolveTenantContext derives org + role from the membership, never from client input", async () => {
    const ctx = await resolveTenantContext(USER_A);
    expect(ctx).toEqual({
      userId: USER_A,
      organizationId: ORG_A,
      role: "organization_owner",
      isStaff: false,
      appMode: getAppMode(),
    });
  });

  it("resolveTenantContext throws for a user with no active membership", async () => {
    await expect(resolveTenantContext("user_none_9999")).rejects.toThrow(
      "No active organization membership"
    );
  });

  it("tenant A sees only its own rows and NOT tenant B's", async () => {
    await withTenant(ORG_A, async (tx) => {
      const contacts = await tx.contact.findMany({ orderBy: { name: "asc" } });
      expect(contacts.map((c) => c.name)).toEqual(["A-contact"]);

      const memberships = await tx.organizationMembership.findMany();
      expect(memberships.map((m) => m.organizationId)).toEqual([ORG_A]);
    });
  });

  it("guessing another tenant's id yields no rows", async () => {
    await withTenant(ORG_A, async (tx) => {
      const guessed = await tx.contact.findMany({ where: { organizationId: ORG_B } });
      expect(guessed).toHaveLength(0);
      const guessedOrg = await tx.organization.findUnique({ where: { id: ORG_B } });
      expect(guessedOrg).toBeNull();
    });
  });

  it("cross-tenant writes are rejected by the WITH CHECK policy", async () => {
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.contact.create({
          data: { organizationId: ORG_B, type: "business", name: "sneaky", email: "s@x.com" },
        })
      )
    ).rejects.toThrow();
  });

  it("unset RLS context hides all rows (secure default)", async () => {
    // deliberately NO set_config in this transaction: the session var is unset
    const contacts = await prisma.$transaction((tx) => tx.contact.findMany());
    expect(contacts).toHaveLength(0);
    const orgs = await prisma.$transaction((tx) => tx.organization.findMany());
    expect(orgs).toHaveLength(0);
  });

  it("org policy: own org + direct children visible, foreign org invisible", async () => {
    await withTenant(ORG_A, async (tx) => {
      const orgs = await tx.organization.findMany({ orderBy: { id: "asc" } });
      expect(orgs.map((o) => o.id).sort()).toEqual([ORG_A, ORG_A_CHILD]);
    });
    // an org that is neither the session tenant nor a child of it cannot be created
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.organization.create({ data: { id: "org_zzzz_0009", name: "Z" } })
      )
    ).rejects.toThrow();
  });

  it("parent chain: a child tenant reads its parent org row via the session-bound helper", async () => {
    await withTenant(ORG_A_CHILD, async (tx) => {
      // helper returns the parent row of the org bound to the session variable
      const parent = await getParentOrg(tx);
      expect(parent?.id).toBe(ORG_A);
      expect(parent?.name).toBe("Tenant A");

      // the parent row is NOT reachable through the plain RLS policy path...
      expect(await tx.organization.findUnique({ where: { id: ORG_A } })).toBeNull();

      // ...and an unrelated org stays invisible through every path
      expect(await tx.organization.findUnique({ where: { id: ORG_B } })).toBeNull();
    });
  });

  it("parent chain: getParentOrg returns null when the tenant has no parent", async () => {
    await withTenant(ORG_A, async (tx) => {
      expect(await getParentOrg(tx)).toBeNull();
    });
    await withTenant(ORG_B, async (tx) => {
      expect(await getParentOrg(tx)).toBeNull();
    });
  });

  it("resolveTenantContext throws on an out-of-union membership role instead of silently casting", async () => {
    // Seed a user + membership with a bogus role via the ADMIN connection —
    // this bypasses app-layer validation and RLS, exactly how a bad value
    // could land in the DB. A silent `as Role` cast would have produced a
    // TenantContext with unknown permission implications.
    await adminQuery(
      `INSERT INTO "User" (id, "idpId", email, "updatedAt")
       VALUES ('user_bad_0001', 'kc-user-bad', 'bad@bad.com', now())
       ON CONFLICT (id) DO NOTHING`
    );
    await adminQuery(
      `INSERT INTO "OrganizationMembership" (id, "userId", "organizationId", role, "updatedAt")
       VALUES ('mem_bad_0001', 'user_bad_0001', $1, 'superuser', now())
       ON CONFLICT (id) DO NOTHING`,
      [ORG_A]
    );
    await expect(resolveTenantContext("user_bad_0001")).rejects.toThrow(
      /Invalid membership role: superuser/
    );
    // teardown: deleting the user cascades the bogus membership
    await adminDeleteUsers(["user_bad_0001"]);
  });
});

describe("isRole (6-role union guard)", () => {
  it("accepts exactly the six membership roles", () => {
    for (const role of [
      "organization_owner",
      "security_admin",
      "asset_manager",
      "scan_operator",
      "report_viewer",
      "billing_admin",
    ]) {
      expect(isRole(role)).toBe(true);
    }
  });

  it("rejects anything outside the union", () => {
    expect(isRole("admin")).toBe(false);
    expect(isRole("member")).toBe(false);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe("staff identity resolution", () => {
  const STAFF_ORG = "org_staff_0001";
  const STAFF_USER = "user_staff_0001";
  // idpId "kc-staff-a", email "staff@a.com" — seeded below; the tenant
  // describe above wipes ITS orgs/users in afterAll, so staff tests own
  // their own org + membership (the request path needs a real one).
  beforeAll(async () => {
    await wipeTenant(STAFF_ORG);
    await adminDeleteUsers([STAFF_USER]);
    await withTenant(STAFF_ORG, async (tx) => {
      await tx.organization.create({ data: { id: STAFF_ORG, name: "Staff Org" } });
      await tx.user.create({ data: { id: STAFF_USER, idpId: "kc-staff-a", email: "staff@a.com" } });
      await tx.organizationMembership.create({
        data: { userId: STAFF_USER, organizationId: STAFF_ORG, role: "organization_owner" },
      });
    });
  });

  afterAll(async () => {
    await wipeTenant(STAFF_ORG);
    await adminDeleteUsers([STAFF_USER]);
  });

  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("resolvesAsStaff honors STAFF_ROLE (default asv-staff, case-insensitive)", async () => {
    const { resolvesAsStaff } = await import("@/lib/tenant");
    vi.stubEnv("STAFF_ROLE", "");
    try {
      expect(resolvesAsStaff(["asv-staff"])).toBe(true);
      expect(resolvesAsStaff(["ASV-STAFF"])).toBe(true);
      expect(resolvesAsStaff(["scan_operator"])).toBe(false);
      expect(resolvesAsStaff([])).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("staffUserIdOverride parses comma-separated ids/emails only in dev/test", async () => {
    const { staffUserIdOverride } = await import("@/lib/tenant");
    vi.stubEnv("STAFF_USER_IDS", "kc-qa-1, qa@x.com , ");
    try {
      expect(staffUserIdOverride()).toEqual(["kc-qa-1", "qa@x.com"]);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(staffUserIdOverride()).toEqual([]); // unset → empty
  });

  // Request-path overlay: the seeded STAFF_USER has a real org + membership,
  // so the full tenantContextFromRequest path runs against the live DB.
  function staffRequest(claims: Record<string, unknown>) {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: claims,
      protectedHeader: {},
    } as never);
    return {
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "authorization" ? "Bearer a.b.c" : null,
      },
    };
  }

  it("prod: a staff realm-role claim reaches tenantContextFromRequest as isStaff=true", async () => {
    vi.stubEnv("APP_MODE", "prod");
    const ctx = await tenantContextFromRequest(
      staffRequest({
        sub: "kc-staff-a",
        email: "staff@a.com",
        realm_access: { roles: ["asv-staff"] },
      }) as never
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.isStaff).toBe(true);
    // the rest of the resolved context is unchanged by the overlay
    expect(ctx?.userId).toBe(STAFF_USER);
    expect(ctx?.organizationId).toBe(STAFF_ORG);
    expect(ctx?.role).toBe("organization_owner");
  });

  it("prod: a non-staff claim stays isStaff=false (fail-closed)", async () => {
    vi.stubEnv("APP_MODE", "prod");
    const ctx = await tenantContextFromRequest(
      staffRequest({ sub: "kc-staff-a", email: "staff@a.com" }) as never
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.isStaff).toBe(false);
  });

  it("dev/test: STAFF_USER_IDS override grants staff via idpId match", async () => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("STAFF_USER_IDS", "kc-staff-a");
    const ctx = await tenantContextFromRequest(
      staffRequest({ sub: "kc-staff-a", email: "staff@a.com" }) as never
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.isStaff).toBe(true);
  });

  it("prod: STAFF_USER_IDS override never grants staff (env list is dev/test only)", async () => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("STAFF_USER_IDS", "kc-staff-a");
    const ctx = await tenantContextFromRequest(
      staffRequest({ sub: "kc-staff-a", email: "staff@a.com" }) as never
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.isStaff).toBe(false);
  });
});
