import { describe, expect, it } from "vitest";
import { customerHomeCards } from "./CustomerHome";
import type { CustomerHomeView } from "@/lib/customer/home";

const emptyView: CustomerHomeView = { organization: { id: "org-a", name: "Acme", parentName: null }, assets: { total: 0, verified: 0, pending: 0 }, scans: { total: 0, latest: null }, reports: { total: 0, latest: null }, activity: [] };

describe("customer home view", () => {
  it("derives cards from persisted view data", () => {
    expect(customerHomeCards(emptyView)).toEqual([{ label: "Active assets", value: "0", href: "/customer/assets" }, { label: "Verified assets", value: "0", href: "/customer/assets?lifecycleState=active" }, { label: "Scans", value: "0", href: "/customer/scans" }, { label: "Reports", value: "0", href: "/customer/reports" }]);
  });
});
