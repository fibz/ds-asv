import { describe, it, expect } from "vitest";
import { assertProdLock } from "@/lib/prod-lock";

/**
 * Spec §6: "Prod is locked: refuse to start (or hard-fail) if gates are
 * disabled in prod." rbac.can() relaxes every gate when appMode !== "prod"
 * (see @/lib/auth/rbac), so a production deployment accidentally started with
 * APP_MODE=dev (or unset) would run with every RBAC gate off. assertProdLock
 * is the startup guard: it must hard-fail exactly that misconfiguration.
 * instrumented via src/instrumentation.ts register().
 */
describe("prod-lock startup guard", () => {
  it("throws when NODE_ENV=production and APP_MODE=dev", () => {
    expect(() => assertProdLock("production", "dev")).toThrow(/APP_MODE must be 'prod'/);
  });

  it("throws when NODE_ENV=production and APP_MODE is unset (defaults to dev)", () => {
    expect(() => assertProdLock("production", undefined)).toThrow(/APP_MODE must be 'prod'/);
  });

  it("throws when NODE_ENV=production and APP_MODE is empty (defaults to dev)", () => {
    expect(() => assertProdLock("production", "")).toThrow(/APP_MODE must be 'prod'/);
  });

  it("passes when NODE_ENV=production and APP_MODE=prod", () => {
    expect(() => assertProdLock("production", "prod")).not.toThrow();
  });

  it("passes for non-production environments regardless of APP_MODE", () => {
    expect(() => assertProdLock("development", "dev")).not.toThrow();
    expect(() => assertProdLock("development", "prod")).not.toThrow();
    expect(() => assertProdLock("test", undefined)).not.toThrow();
    expect(() => assertProdLock(undefined, undefined)).not.toThrow();
  });
});
