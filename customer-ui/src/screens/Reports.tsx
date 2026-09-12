// customer-ui/src/screens/Reports.tsx
import { Link } from "react-router-dom";
import { useReports, useScans, useScopeSets } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
import type { ReportApi, ScopeVersionApi } from "../lib/api/types";
import { Badge } from "../components/primitives/Badge";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { GateCallout } from "../components/shell/GateCallout";
import { Skeleton } from "../components/shell/Skeleton";
import { StageProgress } from "../components/shell/StageProgress";
import { ErrorState, PermissionState } from "../components/shell/states";
import { approvedScopeVersionIdFor, reportGate, type GateView } from "../lib/viewmodels/gate";
import { recordLabel, recordStateFromReport, toneForRecord, type RecordState, type StageState } from "../lib/status";

// Status is never colour alone: every state carries a distinct glyph beside its word.
const RECORD_GLYPH: Record<RecordState, string> = {
  passed: "✔", running: "◐", failed: "✕",
  draft: "○", submitted: "◐", attested: "✔", final: "✔",
  pending: "○", unknown: "○",
};

function periodLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/**
 * The four gate steps, derived from THIS report's gate so the stepper and the
 * callout can never disagree. A generated report means the scan completed and
 * findings were ingested; the last two steps track the gate conditions.
 */
function reportSteps(report: ReportApi, gate: GateView): { label: string; state: StageState }[] {
  const attestationMet = gate.conditions.find((c) => c.key === "attestation")?.met ?? false;
  return [
    { label: "Scan complete", state: "complete" },
    { label: "Findings in", state: report.summary ? "complete" : "pending" },
    { label: "Attested", state: attestationMet ? "complete" : report.status === "submitted" ? "active" : "pending" },
    { label: "Final", state: gate.isFinal ? "complete" : attestationMet ? "active" : "pending" },
  ];
}

export function Reports() {
  const reports = useReports();
  const scans = useScans();
  const scopeSets = useScopeSets();

  const sets = scopeSets.data ?? [];
  const versions: ScopeVersionApi[] = sets.flatMap((s) => s.versions ?? []);

  // Label the recorded version by the set it belongs to, so "Production v3" is
  // readable rather than a bare id.
  const labelById = new Map<string, string>();
  for (const s of sets) {
    for (const v of s.versions ?? []) labelById.set(v.id, `${s.name} v${v.versionNumber}`);
  }
  const scopeLabelFor = (id: string | null): string | null => (id ? labelById.get(id) ?? id : null);

  const rows = [...(reports.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // A 403 on the reports list is a permission wall, not a read failure.
  const forbidden = reports.error instanceof ApiError && reports.error.status === 403;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <h1 className="text-[18px] font-semibold">Reports</h1>
      <p className="text-[14px] text-[var(--ink-muted)] mt-1">
        Each report records the scope version it was run against. A report is final only when it is attested and the
        version it records is approved.
      </p>

      <div className="mt-6">
        {reports.error && !forbidden ? (
          <ErrorState message="We couldn’t read your reports." onRetry={() => void reports.refetch()} />
        ) : null}
        {forbidden ? <PermissionState permission="report.view" /> : null}
        {reports.isLoading ? <Skeleton lines={5} /> : null}

        {!reports.isLoading && !reports.error && rows.length === 0 ? (
          <EmptyState
            title="No reports yet"
            description="A report is generated from a completed scan. Once a scan finishes, its findings and finalisation gate appear here."
            action={
              <Link
                to="/scans"
                className="rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2"
              >
                Open scans
              </Link>
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <ul className="space-y-3">
            {rows.map((r) => {
              // Per-report finality, matching the server: the version this report
              // records must ITSELF be approved. Never compare against the newest
              // approved version — a report from an earlier quarter stays final.
              const gate = reportGate({
                status: r.status,
                scopeVersionId: r.scopeVersionId,
                approvedScopeVersionId: approvedScopeVersionIdFor(r.scopeVersionId, versions),
                attestationStatus: r.attestation?.status ?? null,
                scopeLabel: scopeLabelFor(r.scopeVersionId),
                attestedAt: r.attestation?.reviewedAt ?? null,
              });
              const state = recordStateFromReport(r.status, gate.isFinal);
              const scanName = (scans.data ?? []).find((s) => s.id === r.scanId)?.name;

              return (
                <li key={r.id} data-testid="report-card">
                  <Card
                    title={`${scanName ?? "Report"} — ${periodLabel(r.createdAt)}`}
                    action={
                      <Badge tone={toneForRecord(state)}>
                        <span data-testid={`report-state-${r.id}`}>
                          <span aria-hidden="true">{RECORD_GLYPH[state]}</span> {recordLabel(state)}
                        </span>
                      </Badge>
                    }
                  >
                    <p className="text-[12px] text-[var(--ink-muted)]">
                      Scope version {scopeLabelFor(r.scopeVersionId) ?? "not recorded"}
                    </p>
                    <div className="mt-3">
                      <StageProgress steps={reportSteps(r, gate)} />
                    </div>
                    <div className="mt-3">
                      <GateCallout gate={gate} reportId={r.id} />
                    </div>
                    <div className="mt-3">
                      <Link to={`/reports/${r.id}`} className="text-[13px] font-medium">
                        Open report →
                      </Link>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
