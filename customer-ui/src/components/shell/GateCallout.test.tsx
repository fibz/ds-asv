import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GateCallout } from "./GateCallout";
import { reportGate } from "../../lib/viewmodels/gate";

const finalGate = () =>
  reportGate({
    status: "attested",
    scopeVersionId: "v4",
    approvedScopeVersionId: "v4",
    attestationStatus: "attested",
    scopeLabel: "Production v4",
    attestedAt: "2026-09-03",
  });

const pendingGate = () =>
  reportGate({
    status: "submitted",
    scopeVersionId: "v4",
    approvedScopeVersionId: "v4",
    attestationStatus: "submitted",
    scopeLabel: "Production v4",
    attestedAt: null,
  });

describe("GateCallout", () => {
  it("shows both conditions with their evidence and offers the download when final", () => {
    render(<GateCallout gate={finalGate()} reportId="r1" />);
    expect(screen.getByText("Finalisation gate")).toBeInTheDocument();
    expect(screen.getByText("QA attestation")).toBeInTheDocument();
    expect(screen.getByText("Scope version approved")).toBeInTheDocument();
    // Evidence sits to the right of each condition row.
    expect(screen.getByText("attested 2026-09-03")).toBeInTheDocument();
    expect(screen.getByText("Production v4")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Download PDF/i });
    expect(link).toHaveAttribute("href", "/api/v1/reports/r1/download");
  });

  it("tones each row: pass when the condition is met, warn when it is not", () => {
    render(<GateCallout gate={pendingGate()} reportId="r1" />);
    const rows = screen.getAllByRole("listitem");
    // Attestation is unmet → warn; scope version approved → pass.
    expect(rows[0].querySelector(".tone-warn")).not.toBeNull();
    expect(rows[0].querySelector(".tone-pass")).toBeNull();
    expect(rows[1].querySelector(".tone-pass")).not.toBeNull();
    expect(rows[1].querySelector(".tone-warn")).toBeNull();
  });

  it("states the position in one sentence", () => {
    render(<GateCallout gate={finalGate()} reportId="r1" />);
    expect(screen.getByText(/^Attested on 2026-09-03/)).toBeInTheDocument();
  });

  it("names the missing condition and offers no download when not final", () => {
    render(<GateCallout gate={pendingGate()} reportId="r1" />);
    expect(screen.getByText(/Attestation pending/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download PDF/i })).toBeNull();
    // The explanation must not be hidden behind a dead control.
    expect(screen.queryByRole("button", { name: /Download/i })).toBeNull();
  });
});
