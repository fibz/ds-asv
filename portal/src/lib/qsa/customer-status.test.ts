import { describe, expect, it } from "vitest";
import { customerQsaStatusLabel } from "./customer-status";

describe("customer-safe QSA status labels", () => {
  it.each([
    [null, "Not assigned"],
    ["queued", "Awaiting QSA review"],
    ["assigned", "Assigned to a QSA"],
    ["in_review", "Under QSA review"],
    ["completed", "QSA review completed"],
    ["cancelled", "QSA assignment cancelled"],
  ] as const)("labels %s", (status, label) => {
    expect(customerQsaStatusLabel(status)).toBe(label);
  });
});
