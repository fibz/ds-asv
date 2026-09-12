import type { StageState } from "../status";
import type { AssetApi, ReportApi, ScanApi, ScopeVersionApi } from "../api/types";

export interface QuarterInfo {
  label: string;
  endsAt: Date;
  daysRemaining: number;
}

const MS_PER_DAY = 86_400_000;

export function quarterInfo(now: Date): QuarterInfo {
  const year = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  // Last moment of the quarter: day 0 of the month after the quarter's third month.
  const endsAt = new Date(Date.UTC(year, q * 3, 0, 23, 59, 59));
  // Whole calendar days from today to the quarter's final day — counting from midnight
  // to midnight, so a quarter ending later today reads as 0 rather than rounding up to 1.
  const todayStart = Date.UTC(year, now.getUTCMonth(), now.getUTCDate());
  const finalDayStart = Date.UTC(year, q * 3, 0);
  const daysRemaining = Math.max(0, Math.round((finalDayStart - todayStart) / MS_PER_DAY));
  return { label: `Q${q} ${year}`, endsAt, daysRemaining };
}

export interface TaskView {
  id: string;
  index: number;
  title: string;
  meta: string;
  dueLabel: string | null;
  state: StageState;
  href: string;
  actionLabel: string | null;
  current: boolean;
}

export interface TaskInput {
  assets: AssetApi[];
  approved: ScopeVersionApi | null;
  hasDraftScope: boolean;
  scans: ScanApi[];
  reports: ReportApi[];
  finalReportIds: string[];
  now: Date;
}

export function quarterTasks(input: TaskInput): TaskView[] {
  const active = input.assets.filter((a) => a.lifecycleState !== "retired");
  const verified = active.filter((a) => a.verificationState === "verified").length;
  const running = input.scans.filter((s) => s.status.toUpperCase() === "RUNNING").length;
  const finals = input.reports.filter((r) => input.finalReportIds.includes(r.id)).length;
  const { daysRemaining } = quarterInfo(input.now);
  const due = `${daysRemaining} days left`;

  const steps: Omit<TaskView, "current">[] = [
    {
      id: "assets",
      index: 1,
      title: "Confirm your asset inventory",
      meta: active.length === 0 ? "Nothing to scan yet" : `${verified} of ${active.length} verified`,
      dueLabel: null,
      href: "/assets",
      state: active.length === 0 ? "pending" : verified === active.length ? "complete" : "active",
      actionLabel:
        active.length === 0
          ? "Add your first asset"
          : verified === active.length
            ? null
            : "Verify assets",
    },
    {
      id: "scope",
      index: 2,
      title: "Get your scope approved",
      meta: input.approved
        ? `v${input.approved.versionNumber} approved`
        : input.hasDraftScope
          ? "Draft awaiting submission"
          : "No scope yet",
      dueLabel: null,
      href: "/scope",
      state: input.approved ? "complete" : input.hasDraftScope ? "active" : "pending",
      actionLabel: input.approved ? null : "Build scope",
    },
    {
      id: "scans",
      index: 3,
      title: "Run this quarter's scans",
      meta:
        running > 0
          ? `${running} running now`
          : input.scans.length > 0
            ? `${input.scans.length} run this quarter`
            : "No scans yet",
      dueLabel: due,
      href: "/scans",
      state: running > 0 ? "active" : input.scans.length === 0 ? "pending" : "complete",
      actionLabel: running > 0 ? null : "Start a scan",
    },
    {
      id: "findings",
      index: 4,
      title: "Review findings and dispute anything wrong",
      meta: input.scans.length === 0 ? "Available once a scan completes" : "Open findings are listed per scan",
      dueLabel: null,
      href: "/reports",
      state: input.scans.length === 0 ? "pending" : "active",
      actionLabel: input.scans.length === 0 ? null : "Review findings",
    },
    {
      id: "reports",
      index: 5,
      title: "Finalise this quarter's report",
      meta: finals > 0 ? `${finals} final` : input.reports.length > 0 ? "Attestation pending" : "No report generated yet",
      dueLabel: due,
      href: "/reports",
      state: finals > 0 ? "complete" : input.reports.length > 0 ? "active" : "pending",
      actionLabel: finals > 0 ? null : "Open reports",
    },
  ];

  // Exactly one step is current: the first that is not complete.
  const firstUnfinished = steps.find((s) => s.state !== "complete")?.id;
  return steps.map((s) => ({ ...s, current: s.id === firstUnfinished }));
}
