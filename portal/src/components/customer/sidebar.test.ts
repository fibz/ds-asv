import { describe, expect, it } from "vitest";
import { customerNavigation } from "./sidebar";

describe("customer navigation", () => {
  it("contains only customer routes", () => {
    expect(customerNavigation.map((item) => item.href)).toEqual([
      "/customer",
      "/customer/assets",
      "/customer/scope",
      "/customer/scans",
      "/customer/reports",
      "/customer/team",
      "/customer/access",
      "/customer/audit",
      "/customer/settings",
    ]);
    expect(customerNavigation.some((item) => item.href.startsWith("/qsa"))).toBe(false);
  });
});
