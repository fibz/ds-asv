import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

function loadSpec(): Record<string, any> {
  const file = fs.readFileSync(path.join(process.cwd(), "spec", "openapi.yaml"), "utf-8");
  return yaml.load(file) as Record<string, any>;
}

describe("user center API contract", () => {
  const spec = loadSpec();
  const paths = spec.paths ?? {};

  it("documents org profile", () => {
    expect(paths["/org"]).toBeDefined();
    expect(paths["/org"].get).toBeDefined();
    expect(paths["/org"].patch).toBeDefined();
  });

  it("documents team management", () => {
    expect(paths["/team/members"].get).toBeDefined();
    const member = paths["/team/members/{memberId}"];
    expect(member.patch).toBeDefined();
    expect(member.delete).toBeDefined();
  });

  it("documents sessions", () => {
    expect(paths["/sessions"].get).toBeDefined();
    expect(paths["/sessions/{sessionId}/revoke"].post).toBeDefined();
  });

  it("documents the audit trail", () => {
    expect(paths["/audit"].get).toBeDefined();
  });

  it("documents invitations", () => {
    expect(paths["/invitations"].post).toBeDefined();
  });

  it("defines shared schemas", () => {
    const schemas = spec.components?.schemas ?? {};
    for (const name of ["OrgProfile", "ContactInput", "Member", "Session", "AuditEvent", "Error"]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });
});

describe("phase 3 scan contract", () => {
  const spec = loadSpec();
  const paths = spec.paths ?? {};

  it("documents scan lifecycle", () => {
    expect(paths["/scans"].post).toBeDefined();
    expect(paths["/scans"].get).toBeDefined();
    expect(paths["/scans/{scanId}"].get).toBeDefined();
    expect(paths["/scans/{scanId}"].patch).toBeDefined();
  });

  it("documents findings ingestion and reports", () => {
    expect(paths["/scans/{scanId}/findings"].post).toBeDefined();
    expect(paths["/scans/{scanId}/findings"].get).toBeDefined();
    expect(paths["/reports/{reportId}"].get).toBeDefined();
    expect(paths["/reports/{reportId}/attest"].post).toBeDefined();
  });

  it("no longer documents the legacy stopScan delete", () => {
    expect(paths["/scans/{scanId}"].delete).toBeUndefined();
  });

  it("defines scan-domain schemas", () => {
    const schemas = spec.components?.schemas ?? {};
    for (const name of ["Scan", "ScanTarget", "Finding", "Report", "ReportAttestation", "ScanCreate"]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });
});

describe("phase 4 scope + authorization contract", () => {
  const spec = loadSpec();
  const paths = spec.paths ?? {};

  it("documents scope set and version lifecycle", () => {
    expect(paths["/scope-sets"].get).toBeDefined();
    expect(paths["/scope-sets"].post).toBeDefined();
    expect(paths["/scope-sets/{scopeSetId}/versions"].post).toBeDefined();
    expect(paths["/scope-versions/{versionId}/submit"].post).toBeDefined();
    expect(paths["/scope-versions/{versionId}/approve"].post).toBeDefined();
    expect(paths["/scope-versions/{versionId}/authorization"].post).toBeDefined();
  });

  it("defines scope-domain schemas", () => {
    const schemas = spec.components?.schemas ?? {};
    for (const name of ["ScopeSet", "ScopeVersion", "ScopeItem", "Authorization", "AuthorizationIssued"]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });
});
