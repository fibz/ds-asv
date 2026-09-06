import { describe, it, expect } from "vitest";
import { assertSecretsBootstrapped } from "@/lib/secret-bootstrap";

const PROD_ENV = {
  DATABASE_URL: "postgresql://asv_app:real-prod-pw@db.internal:5432/asv_portal",
  ADMIN_DATABASE_URL: "postgresql://asv:real-prod-pw@db.internal:5432/asv_portal",
  MANIFEST_SECRET: "real-manifest-secret",
  KEYCLOAK_CLIENT_SECRET: "real-client-secret",
};

describe("secret bootstrap guard", () => {
  it("passes a fully-injected prod env (env/Vault bootstrap)", () => {
    expect(() => assertSecretsBootstrapped("prod", PROD_ENV)).not.toThrow();
  });

  it("passes dev/test regardless of dev-looking values", () => {
    expect(() => assertSecretsBootstrapped("dev", {
      DATABASE_URL: "postgresql://asv_app:asv@localhost:5433/asv_portal",
      ADMIN_DATABASE_URL: "postgresql://asv:asv@localhost:5433/asv_portal",
      MANIFEST_SECRET: "dev-manifest-secret",
      KEYCLOAK_CLIENT_SECRET: "dev-asv-client-secret-change-me",
    })).not.toThrow();
    expect(() => assertSecretsBootstrapped("", {})).not.toThrow();
  });

  it("refuses prod when DATABASE_URL is the hardcoded dev password", () => {
    expect(() => assertSecretsBootstrapped("prod", {
      ...PROD_ENV,
      DATABASE_URL: "postgresql://asv_app:asv@localhost:5433/asv_portal",
    })).toThrow(/DATABASE_URL/);
  });

  it("refuses prod when DATABASE_URL is a CHANGE_ME placeholder", () => {
    expect(() => assertSecretsBootstrapped("prod", {
      ...PROD_ENV,
      DATABASE_URL: "postgresql://asv_app:CHANGE_ME@db:5432/asv_portal",
    })).toThrow(/DATABASE_URL/);
  });

  it("refuses prod when ADMIN_DATABASE_URL is missing", () => {
    expect(() => assertSecretsBootstrapped("prod", { ...PROD_ENV, ADMIN_DATABASE_URL: undefined })).toThrow(/ADMIN_DATABASE_URL/);
  });

  it("refuses prod when MANIFEST_SECRET is unset or the dev fallback", () => {
    expect(() => assertSecretsBootstrapped("prod", { ...PROD_ENV, MANIFEST_SECRET: undefined })).toThrow(/MANIFEST_SECRET/);
    expect(() => assertSecretsBootstrapped("prod", { ...PROD_ENV, MANIFEST_SECRET: "dev-manifest-secret" })).toThrow(/MANIFEST_SECRET/);
  });

  it("refuses prod when KEYCLOAK_CLIENT_SECRET is the dev realm secret", () => {
    expect(() => assertSecretsBootstrapped("prod", { ...PROD_ENV, KEYCLOAK_CLIENT_SECRET: "dev-asv-client-secret-change-me" })).toThrow(/KEYCLOAK_CLIENT_SECRET/);
    expect(() => assertSecretsBootstrapped("prod", { ...PROD_ENV, KEYCLOAK_CLIENT_SECRET: "change-me" })).toThrow(/KEYCLOAK_CLIENT_SECRET/);
  });
});
