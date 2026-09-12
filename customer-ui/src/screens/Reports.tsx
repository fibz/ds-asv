// customer-ui/src/screens/Reports.tsx
import { Link, useSearchParams } from "react-router-dom";
import { useGenerateReport, useReports, useScans, useScopeSets } from "../lib/api/queries";
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

  // A scan row's "Findings →" links here with ?scan=<id>. Until a report exists
  // for that scan there is nothing to read, so offer the one action that
  // creates it rather than leaving the reader at a dead end.
  const [params] = useSearchParams();
  const scanId = params.get("scan");
  const generate = useGenerateReport();
  const scan = (scans.data ?? []).find((s) => s.id === scanId) ?? null;
  const reportForScan = scanId ? rows.find((r) => r.scanId === scanId) ?? null : null;
  const targeted = Boolean(scanId) && !reportForScan;
  const scanCompleted = (scan?.status ?? "").toUpperCase() === "COMPLETED";
  const generateError = generate.error;
  const generateMessage = generateError
    ? generateError.status === 403
      ? "You don’t have permission to generate reports."
      : generateError.status === 409
        ? "This scan hasn’t completed yet."
        : generateError.status === 404
          ? "That scan is no longer available."
          : "We couldn’t generate the report. Try again."
    : null;

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

        {targeted ? (
          <section
            className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
            data-testid="generate-report"
          >
            <p className="text-[14px] font-medium">
              {scan ? `No report for ${scan.name} yet` : "No report for this scan yet"}
            </p>
            <p className="text-[13px] text-[var(--ink-muted)] mt-1">
              Generating a report records this scan’s findings against the scope version it was run under.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => scanId && generate.mutate(scanId)}
                disabled={generate.isPending || !scanCompleted}
                className="rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2 disabled:opacity-50"
              >
                {generate.isPending ? "Generating…" : "Generate report"}
              </button>
              {!scanCompleted ? (
                <span className="text-[13px] text-[var(--ink-muted)]">This scan hasn’t completed yet.</span>
              ) : null}
              {generateMessage ? (
                <span role="alert" className="text-[13px] text-[var(--fail)]">
                  {generateMessage}
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        {!targeted && !reports.isLoading && !reports.error && rows.length === 0 ? (
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
                      <GateCallout gate={gate} reportId={r.id} downloadVariant="secondary" />
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
