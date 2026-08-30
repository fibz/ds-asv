import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { parseCsv, previewImport, applyImport, getImportResult } from "@/lib/assets/import";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_asset_import_0001";
const USER = "user_asset_import_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "asset_manager", isStaff: false, appMode: "dev" };

describe("parseCsv", () => {
  it("parses a header + rows with quoted fields", () => {
    const csv = `type,identifier,display_name,owner,environment,criticality\nipv4,10.0.0.1,"Web, prod",a@b.com,production,high\nfqdn,api.example.com,API,,staging,`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ type: "ipv4", identifier: "10.0.0.1", displayName: "Web, prod", owner: "a@b.com", environment: "production", criticality: "high" });
    expect(rows[1].identifier).toBe("api.example.com");
  });
  it("throws on an unknown column header", () => {
    expect(() => parseCsv("type,bogus\nipv4,1.2.3.4")).toThrow(/unknown column/i);
  });
  it("throws on empty input or missing header", () => {
    expect(() => parseCsv("")).toThrow();
    expect(() => parseCsv("10.0.0.1\n")).toThrow();
  });
});

describe("CSV import (idempotent, invalid rows downloadable)", () => {
  beforeAll(async () => {
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    try {
      await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
      await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
    } finally { await admin.end(); }
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Import Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-import", email: "imp@x.com" } });
    });
  });

  afterAll(async () => {
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    try {
      await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
      await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
    } finally { await admin.end(); }
    await prisma.$disconnect();
  });

  it("previews rows as new/duplicate/invalid without writing", async () => {
    // seed one asset so it reads as duplicate in the preview
    await withTenant(ORG, async (tx) => {
      await tx.asset.create({ data: { organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.0.0.1" } });
    });
    const rows = parseCsv(`type,identifier,display_name\nipv4,10.0.0.1,dup\nipv4,10.0.0.2,fresh\nfqdn,-bad.com,invalid\n`);
    const preview = await previewImport(ctx, rows);
    const statuses = Object.fromEntries(preview.rows.map((r) => [r.row.identifier, r.status]));
    expect(statuses["10.0.0.1"]).toBe("duplicate");
    expect(statuses["10.0.0.2"]).toBe("new");
    expect(statuses["-bad.com"]).toBe("invalid");
    // nothing written by preview
    const count = await withTenant(ORG, (tx) => tx.asset.count());
    expect(count).toBe(1);
  });

  it("applies an import idempotently and records invalid rows", async () => {
    // NOTE (Task 6 deviation): brief's CSV listed 3 rows but asserts 4 outcomes
    // (created=2 + duplicates=1 + invalid=1) and references "10.0.0.1 already
    // exists" — so the duplicate row `ipv4,10.0.0.1` was missing. Also the
    // invalid row must yield an error matching /invalid/i; `999.1.1.1` yields
    // "IPv4 octet out of range" (no match), so we reuse the preview test's
    // `fqdn,-bad.com` invalid row ("Invalid FQDN label in: -bad.com").
    const rows = parseCsv(`type,identifier,display_name,owner\nipv4,10.0.0.1,dup,a@b.com\nipv4,10.0.0.2,app-1,a@b.com\nfqdn,api.example.com,api,a@b.com\nfqdn,-bad.com,invalid,\n`);
    const first = await applyImport(ctx, rows, "imp-key-1");
    expect(first.summary.created).toBe(2);
    expect(first.summary.duplicates).toBe(1); // 10.0.0.1 already exists
    expect(first.summary.invalid).toBe(1);
    expect(first.invalidRows).toHaveLength(1);
    expect(first.invalidRows[0].errors.join(" ")).toMatch(/invalid/i);

    // idempotency: replaying the same key returns the stored result, no new rows
    const replay = await applyImport(ctx, rows, "imp-key-1");
    expect(replay.importId).toBe(first.importId);
    const count = await withTenant(ORG, (tx) => tx.asset.count());
    expect(count).toBe(3); // 10.0.0.1 seed + 2 created

    // result is retrievable (downloadable invalid rows)
    const stored = await getImportResult(ctx, first.importId);
    expect((stored?.summary as { created: number } | undefined)?.created).toBe(2);
    expect(stored?.invalidRows).toHaveLength(1);
  });

  it("short-circuits idempotent replay without re-applying assets", async () => {
    // apply, then retire the created asset: a re-apply would re-create it
    // (dedupe + partial unique index both exclude 'retired'), so an unchanged
    // asset count after replay proves the short-circuit fired (no re-apply).
    const rows = parseCsv(`type,identifier,display_name\nipv4,10.0.0.3,sc-test\n`);
    const first = await applyImport(ctx, rows, "imp-short-circuit");
    expect(first.summary.created).toBe(1);
    await withTenant(ORG, async (tx) => {
      await tx.asset.updateMany({
        where: { organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.0.0.3" },
        data: { lifecycleState: "retired" },
      });
    });
    const before = await withTenant(ORG, (tx) => tx.asset.count());
    const replay = await applyImport(ctx, rows, "imp-short-circuit");
    expect(replay.importId).toBe(first.importId);
    const after = await withTenant(ORG, (tx) => tx.asset.count());
    expect(after).toBe(before); // replay did not re-apply the retired asset
  });

  it("counts within-file duplicate rows once in created and once in duplicates", async () => {
    const rows = parseCsv(`type,identifier\nipv4,10.0.0.4\nipv4,10.0.0.4\n`);
    const res = await applyImport(ctx, rows, "imp-file-dup");
    expect(res.summary.total).toBe(2);
    expect(res.summary.created).toBe(1);
    expect(res.summary.duplicates).toBe(1);
  });
});
