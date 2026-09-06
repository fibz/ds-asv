import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Finding } from "../api/types";
import { FindingTable } from "./FindingTable";

function finding(severity: Finding["severity"], title: string): Finding {
  return {
    id: `f-${title}`,
    target_id: "t1",
    title,
    severity,
    source: "unauthenticated_banner",
    confidence: "uncertain",
    pci_fail: false,
    is_suppressed: false,
    created_at: "2026-09-06T00:00:00",
  };
}

describe("FindingTable", () => {
  const findings = [
    finding("critical", "Critical issue"),
    finding("high", "High issue"),
    finding("medium", "Medium issue"),
    finding("low", "Low issue"),
  ];

  it("renders a row per finding", () => {
    render(<FindingTable findings={findings} onSelect={vi.fn()} />);
    expect(screen.getByText("Critical issue")).toBeInTheDocument();
    expect(screen.getByText("Medium issue")).toBeInTheDocument();
  });

  it("filters rows by severity floor", () => {
    render(<FindingTable findings={findings} onSelect={vi.fn()} />);
    const select = screen.getByLabelText("Severity floor");
    fireEvent.change(select, { target: { value: "high" } });
    expect(screen.getByText("Critical issue")).toBeInTheDocument();
    expect(screen.getByText("High issue")).toBeInTheDocument();
    expect(screen.queryByText("Medium issue")).not.toBeInTheDocument();
    expect(screen.queryByText("Low issue")).not.toBeInTheDocument();
  });

  it("invokes onSelect with the finding on row click", () => {
    const onSelect = vi.fn();
    render(<FindingTable findings={findings} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Critical issue"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Critical issue" })
    );
  });

  it("shows the empty row when there are no findings", () => {
    render(<FindingTable findings={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/no findings match/i)).toBeInTheDocument();
  });
});
