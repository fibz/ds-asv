import { describe, expect, it } from "vitest";
import { legacyCustomerPath } from "./redirects";

describe("legacy customer redirects", () => {
  it("maps legacy paths and preserves suffixes and query strings", () => {
    expect(legacyCustomerPath("/dashboard")).toBe("/customer");
    expect(legacyCustomerPath("/reports")).toBe("/customer/reports");
    expect(legacyCustomerPath("/assets/example", "?type=fqdn")).toBe("/customer/assets/example?type=fqdn");
    expect(legacyCustomerPath("/unknown", "?x=1")).toBe("/unknown?x=1");
  });
});
