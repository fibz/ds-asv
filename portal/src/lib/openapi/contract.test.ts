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
