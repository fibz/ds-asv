import { beforeEach, describe, expect, it } from "vitest";
import { roleHome, useAuth } from "./store";

const initial = {
  token: null,
  role: null,
  customerId: null,
  customerName: null,
  notice: null,
} as const;

beforeEach(() => {
  localStorage.clear();
  useAuth.setState(initial);
});

describe("roleHome", () => {
  it("maps operator to Watch (/) and qsa to Scans", () => {
    expect(roleHome("operator")).toBe("/");
    expect(roleHome("qsa")).toBe("/scans");
  });
});

describe("auth store transitions", () => {
  it("starts unauthenticated", () => {
    const s = useAuth.getState();
    expect(s.token).toBeNull();
    expect(s.role).toBeNull();
  });

  it("setSession stores operator identity and clears any notice", () => {
    useAuth.setState({ notice: "stale" });
    useAuth.getState().setSession({
      token: "op-token",
      role: "operator",
    });
    const s = useAuth.getState();
    expect(s.token).toBe("op-token");
    expect(s.role).toBe("operator");
    expect(s.customerId).toBeNull();
    expect(s.notice).toBeNull();
  });

  it("setSession keeps qsa customer scope", () => {
    useAuth.getState().setSession({
      token: "qsa-token",
      role: "qsa",
      customerId: "cust-1",
      customerName: "Acme Co",
    });
    const s = useAuth.getState();
    expect(s.customerId).toBe("cust-1");
    expect(s.customerName).toBe("Acme Co");
  });

  it("clearSession wipes identity and carries a notice", () => {
    useAuth.getState().setSession({ token: "t", role: "operator" });
    useAuth.getState().clearSession("Session expired");
    const s = useAuth.getState();
    expect(s.token).toBeNull();
    expect(s.role).toBeNull();
    expect(s.notice).toBe("Session expired");
  });

  it("persists token+role to localStorage (partialize excludes notice)", () => {
    useAuth.getState().setSession({ token: "persisted", role: "operator" });
    const raw = localStorage.getItem("asv-scanner-auth");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state?: { token?: string } };
    expect(parsed.state?.token).toBe("persisted");
  });
});
