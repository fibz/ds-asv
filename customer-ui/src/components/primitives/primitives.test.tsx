// customer-ui/src/components/primitives/primitives.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";
import { StatusChip } from "./StatusChip";
import { Card } from "./Card";
import { Stat } from "./Stat";
import { EmptyState } from "./EmptyState";

describe("Button", () => {
  it("calls onClick when enabled", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run scan</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Run scan" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("states why it is disabled instead of failing silently", () => {
    render(<Button disabled disabledReason="An approved scope is required first">New scan</Button>);
    const btn = screen.getByRole("button", { name: "New scan" });
    expect(btn).toBeDisabled();
    expect(screen.getByText("An approved scope is required first")).toBeInTheDocument();
  });

  it("keeps a caller-supplied aria-describedby when it renders no reason of its own", () => {
    render(<Button aria-describedby="why">Run</Button>);
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("aria-describedby", "why");
  });
});

describe("StatusChip", () => {
  it("pairs the tone class with a glyph and a word", () => {
    render(<StatusChip state="complete" detail="4 verified" />);
    const chip = screen.getByText(/Done/).closest(".tone-pass")!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("\u2714");
    expect(chip.textContent).toContain("4 verified");
  });
});

describe("Card / Stat / EmptyState", () => {
  it("renders a title and an action", () => {
    render(<Card title="Approved scope" action={<Button>View</Button>}>body</Card>);
    expect(screen.getByText("Approved scope")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders a stat with its caption", () => {
    render(<Stat label="Open findings" value="9" caption="2 high severity" />);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("2 high severity")).toBeInTheDocument();
  });

  it("empty state offers exactly one action", () => {
    render(<EmptyState title="No assets yet" description="Import a CSV or add one by hand." action={<Button>Add asset</Button>} />);
    expect(screen.getByText("No assets yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
