// customer-ui/src/lib/auth/auth.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { signInUrl, signOutUrl } from "./auth";

describe("signInUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks the portal to return the user to this app after login", () => {
    vi.stubEnv("BASE_URL", "/app/");
    expect(signInUrl()).toBe("/api/auth/login?returnTo=%2Fapp%2F");
  });

  it("follows whatever base the app is mounted on instead of hardcoding /app/", () => {
    vi.stubEnv("BASE_URL", "/ui/");
    expect(signInUrl()).toBe("/api/auth/login?returnTo=%2Fui%2F");
  });

  it("always sends a rooted local path (the portal rejects anything else)", () => {
    const value = decodeURIComponent(signInUrl().split("returnTo=")[1]);
    expect(value.startsWith("/")).toBe(true);
    expect(value.startsWith("//")).toBe(false);
  });
});

describe("signOutUrl", () => {
  it("stays the portal's POST-only logout", () => {
    expect(signOutUrl()).toBe("/api/auth/logout");
  });
});
