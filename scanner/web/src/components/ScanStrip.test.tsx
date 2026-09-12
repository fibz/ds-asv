import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScanHistoryItem } from "../api/types";
import { ScanStrip } from "./ScanStrip";

function scan(over: Partial<ScanHistoryItem> & { scan_id: string }): ScanHistoryItem {
  return {
    status: "running",
    scan_type: "quarterly",
    submitted_at: new Date(Date.now() - 60_000).toISOString(),
    targets: ["10.0.0.1"],
    ...over,
  } as ScanHistoryItem;
}

describe("ScanStrip", () => {
  it("renders one block per in-flight scan with the target + status", () => {
    render(
      <ScanStrip
        scans={[
          scan({ scan_id: "s1", targets: ["host-a.example"] }),
          scan({ scan_id: "s2", status: "enqueued", targets: ["host-b.example"] }),
        ]}
      />
    );
    expect(screen.getByText("host-a.example")).toBeInTheDocument();
    expect(screen.getByText("host-b.example")).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("enqueued")).toBeInTheDocument();
  });

  it("excludes terminal scans from the strip", () => {
    render(
      <ScanStrip
        scans={[
          scan({ scan_id: "done", status: "completed", targets: ["gone.example"] }),
          scan({ scan_id: "live", targets: ["live.example"] }),
        ]}
      />
    );
    expect(screen.getByText("live.example")).toBeInTheDocument();
    expect(screen.queryByText("gone.example")).not.toBeInTheDocument();
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is in flight", () => {
    render(<ScanStrip scans={[scan({ scan_id: "done", status: "failed" })]} />);
    expect(screen.getByText("no scans in flight")).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
  });
});
