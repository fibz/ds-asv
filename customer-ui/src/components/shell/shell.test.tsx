import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { LifecycleNav } from "./LifecycleNav";
import { StageProgress } from "./StageProgress";
import { ContextBar } from "./ContextBar";
import { stageRows } from "../../lib/viewmodels/stages";

const stages = stageRows({ assets: [], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });
const renderInRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("LifecycleNav", () => {
  it("numbers the four stages and shows each one's state word", () => {
    renderInRouter(<LifecycleNav stages={stages} />);
    expect(screen.getByRole("navigation", { name: /scan cycle/i })).toBeInTheDocument();
    for (const label of ["Assets", "Scope", "Scans", "Reports"]) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Not started/)).toHaveLength(4);
  });

  it("links the Manage group to the second-pass destinations", () => {
    renderInRouter(<LifecycleNav stages={stages} />);
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("href", "/team");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("signs out with a POST form, not a link", () => {
    renderInRouter(<LifecycleNav stages={stages} />);
    const form = screen.getByRole("button", { name: /sign out/i }).closest("form");
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/logout");
  });
});

describe("StageProgress", () => {
  it("marks each step as filled, current or hollow", () => {
    renderInRouter(<StageProgress steps={[{ label: "Scan", state: "complete" }, { label: "Findings", state: "complete" }, { label: "Attested", state: "active" }, { label: "Final", state: "pending" }]} />);
    expect(screen.getByTestId("step-Attested")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("step-Final")).toHaveAttribute("data-state", "pending");
  });
});

describe("ContextBar", () => {
  it("warns once the window is inside 14 days", () => {
    renderInRouter(<ContextBar orgName="Northwind Retail" quarter="Q3 2026" daysRemaining={12} />);
    expect(screen.getByText(/12 days/).className).toContain("tone-warn");
  });

  it("stays neutral outside the warning window", () => {
    renderInRouter(<ContextBar orgName="Northwind Retail" quarter="Q3 2026" daysRemaining={40} />);
    expect(screen.getByText(/40 days/).className).not.toContain("tone-warn");
  });
});
