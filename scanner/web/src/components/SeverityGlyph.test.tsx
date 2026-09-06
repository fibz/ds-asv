import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeverityGlyph } from "./SeverityGlyph";

describe("SeverityGlyph", () => {
  it("renders ▲ for critical with the label text", () => {
    render(<SeverityGlyph severity="critical" label />);
    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
  });
  it("renders the severity glyphs without labels", () => {
    const { container } = render(<SeverityGlyph severity="high" />);
    expect(container).toHaveTextContent("●");
  });
  it("maps each severity to its glyph", () => {
    const expectations: Array<[string, string]> = [
      ["critical", "▲"],
      ["high", "●"],
      ["medium", "◆"],
      ["low", "▪"],
      ["info", "—"],
    ];
    for (const [severity, glyph] of expectations) {
      const { container, unmount } = render(
        <SeverityGlyph severity={severity as never} />
      );
      expect(container.textContent).toContain(glyph);
      unmount();
    }
  });
});
