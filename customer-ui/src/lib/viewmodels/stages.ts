import type { StageState } from "../status";
import type { AssetApi, ReportApi, ScanApi, ScopeVersionApi } from "../api/types";

export type StageKey = "assets" | "scope" | "scans" | "reports";

export interface StageRow {
  key: StageKey;
  index: number;
  label: string;
  href: string;
  state: StageState;
  detail: string;
}

export interface StageInput {
  assets: AssetApi[];
  approved: ScopeVersionApi | null;
  hasDraftScope: boolean;
  scans: ScanApi[];
  reports: ReportApi[];
  finalReportIds: string[];
}

export function stageRows(input: StageInput): StageRow[] {
  const active = input.assets.filter((a) => a.lifecycleState !== "retired");
  const verified = active.filter((a) => a.verificationState === "verified");
  const running = input.scans.filter((s) => s.status.toUpperCase() === "RUNNING");
  const finals = input.reports.filter((r) => input.finalReportIds.includes(r.id));

  const assetsState: StageState =
    active.length === 0 ? "pending" : verified.length === active.length ? "complete" : "active";
  const scopeState: StageState = input.approved ? "complete" : input.hasDraftScope ? "active" : "pending";
  const scansState: StageState =
    running.length > 0 ? "active" : input.scans.length === 0 ? "pending" : "complete";
  const reportsState: StageState =
    finals.length > 0 ? "complete" : input.reports.length === 0 ? "pending" : "active";

  return [
    {
      key: "assets",
      index: 1,
      label: "Assets",
      href: "/assets",
      state: assetsState,
      detail: active.length === 0 ? "none yet" : `${verified.length} of ${active.length} verified`,
    },
    {
      key: "scope",
      index: 2,
      label: "Scope",
      href: "/scope",
      state: scopeState,
      detail: input.approved
        ? `v${input.approved.versionNumber} approved`
        : input.hasDraftScope
          ? "draft in progress"
          : "not created",
    },
    {
      key: "scans",
      index: 3,
      label: "Scans",
      href: "/scans",
      state: scansState,
      detail:
        running.length > 0
          ? `${running.length} running`
          : input.scans.length === 0
            ? "none yet"
            : `${input.scans.length} this quarter`,
    },
    {
      key: "reports",
      index: 4,
      label: "Reports",
      href: "/reports",
      state: reportsState,
      detail:
        finals.length > 0
          ? `${finals.length} final`
          : input.reports.length > 0
            ? "needs attestation"
            : "none yet",
    },
  ];
}
