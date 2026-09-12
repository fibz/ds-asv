import { describe, expect, it } from "vitest";
import { qsaNavigation } from "./sidebar";

describe("QSA navigation", () => {
  it("contains only QSA routes", () => {
    expect(qsaNavigation.map((item) => item.href)).toEqual(["/qsa", "/qsa/queue", "/qsa/assignments"]);
    expect(qsaNavigation.every((item) => item.href.startsWith("/qsa"))).toBe(true);
  });
});
