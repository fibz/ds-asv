import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PciBar } from "./PciBar";

describe("PciBar", () => {
  it("is amber (#F5A524) when the finding fails PCI", () => {
    const { container } = render(<PciBar fail />);
    const bar = container.querySelector("span");
    expect(bar).toHaveStyle("background-color: #F5A524");
  });
  it("is muted (#3D4A66) when PCI passes", () => {
    const { container } = render(<PciBar fail={false} />);
    const bar = container.querySelector("span");
    expect(bar).toHaveStyle("background-color: #3D4A66");
  });
});
