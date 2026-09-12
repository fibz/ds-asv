// customer-ui/src/screens/ReportDetail.tsx
import { Link, useParams } from "react-router-dom";
import { useId, useState, type FormEvent } from "react";
import { useRaiseDispute, useReports, useScanFindings, useScans, useScopeSets } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
import type { FindingApi, ScopeVersionApi } from "../lib/api/types";
import { Badge } from "../components/primitives/Badge";
import { Button } from "../components/primitives/Button";
import { EmptyState } from "../components/primitives/EmptyState";
import { GateCallout } from "../components/shell/GateCallout";
import { Skeleton } from "../components/shell/Skeleton";
import { ErrorState, PermissionState } from "../components/shell/states";
import { approvedScopeVersionIdFor, reportGate } from "../lib/viewmodels/gate";
import { recordLabel, recordStateFromReport, toneForRecord, type RecordState, type Tone } from "../lib/status";

const RECORD_GLYPH: Record<RecordState, string> = {
  passed: "✔", running: "◐", failed: "✕",
  draft: "○", submitted: "◐", attested: "✔", final: "✔",
  pending: "○", unknown: "○",
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];
const SEVERITY_TONE: Record<string, Tone> = {
  critical: "fail", high: "fail", medium: "warn", low: "idle", info: "idle",
};

const severityLabel = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown");
const severityRank = (s: string) => {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
};

function periodLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/**
 * The justification form for one finding.
 *
 * An empty justification never reaches the network: the route would reject it
 * with a 400 and the merchant would learn nothing from a round trip. The
 * message is associated with the textarea through aria-describedby, so a
 * screen reader announces the reason rather than leaving it somewhere else on
 * the page. A 403 is called out as a permission wall — retrying cannot help.
 */
function DisputeForm({
  findingId, pending, error, onSubmit, onCancel,
}: {
  findingId: string;
  pending: boolean;
  error: ApiError | null;
  onSubmit: (findingId: string, justification: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  const [justification, setJustification] = useState("");
  const [empty, setEmpty] = useState(false);

  const forbidden = error instanceof ApiError && error.status === 403;
  const message = empty
    ? "A justification is required — explain why this finding is disputed."
    : error?.message ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = justification.trim();
    if (!value) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    onSubmit(findingId, value);
  };

  return (
    <form onSubmit={submit} className="mt-3">
      <label htmlFor={`${id}-justification`} className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">
        Justification
      </label>
      <textarea
        id={`${id}-justification`}
        value={justification}
        onChange={(e) => { setJustification(e.target.value); if (empty) setEmpty(false); }}
        rows={3}
        aria-describedby={message ? `${hintId} ${messageId}` : hintId}
        aria-invalid={message ? true : undefined}
        className="mt-1.5 w-full border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] text-[var(--ink)] text-[14px] px-3 py-2"
      />
      <p id={hintId} className="text-[12px] text-[var(--ink-subtle)] mt-1">
        Explain why this finding should be reviewed.
      </p>
      {message ? (
        <p
          id={messageId}
          role="alert"
          className={forbidden ? "mt-2 text-[13px] text-[var(--ink-muted)]" : "mt-2 text-[13px] text-[var(--fail)]"}
        >
          {forbidden ? (
            <>Your role does not have the <code className="text-[12px]">finding.dispute</code> permission, so you can’t raise a dispute. Ask an organisation owner if you need it.</>
          ) : (
            message
          )}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit dispute"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ReportDetail() {
  const { reportId } = useParams<{ reportId: string }>();
  const reports = useReports();
  const scans = useScans();
  const scopeSets = useScopeSets();

  const report = (reports.data ?? []).find((r) => r.id === reportId) ?? null;
  // The query is disabled (and receives null) until the report — and therefore
  // its scan id — is known, so we never fetch findings for an unknown scan.
  const findings = useScanFindings(report?.scanId ?? null);
  // Disputes are a write; the hook owns the refetch of this scan's findings so
  // a newly raised dispute is reflected without the screen juggling cache keys.
  const raiseDispute = useRaiseDispute(report?.scanId ?? null);
  const [disputingFindingId, setDisputingFindingId] = useState<string | null>(null);
  // The mutation keeps its last variables, so the confirmation lands on the
  // finding that was actually disputed — not on whichever one is rendered first.
  const raisedFindingId = raiseDispute.isSuccess ? raiseDispute.variables?.findingId ?? null : null;

  const sets = scopeSets.data ?? [];
  const versions: ScopeVersionApi[] = sets.flatMap((s) => s.versions ?? []);
  const labelById = new Map<string, string>();
  for (const s of sets) {
    for (const v of s.versions ?? []) labelById.set(v.id, `${s.name} v${v.versionNumber}`);
  }
  const scopeLabel = report?.scopeVersionId ? labelById.get(report.scopeVersionId) ?? report.scopeVersionId : null;

  if (reports.isLoading) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <Skeleton lines={6} />
      </div>
    );
  }

  if (reports.error) {
    // A 403 is a permission wall, not a read failure: no retry could help.
    const forbidden = reports.error instanceof ApiError && reports.error.status === 403;
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        {forbidden ? (
          <PermissionState permission="report.view" />
        ) : (
          <ErrorState message="We couldn’t read this report." onRetry={() => void reports.refetch()} />
        )}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <EmptyState
          title="Report could not be found"
          description="It may have been removed, or the link may be out of date."
          action={
            <Link
              to="/reports"
              className="rounded-[var(--radius)] bg-[var(--accent)] text-white text-[14px] font-medium px-3.5 py-2"
            >
              Back to reports
            </Link>
          }
        />
      </div>
    );
  }

  const gate = reportGate({
    status: report.status,
    scopeVersionId: report.scopeVersionId,
    // Per-report finality: the version this report records must itself be approved.
    approvedScopeVersionId: approvedScopeVersionIdFor(report.scopeVersionId, versions),
    attestationStatus: report.attestation?.status ?? null,
    scopeLabel,
    attestedAt: report.attestation?.reviewedAt ?? null,
  });
  const state = recordStateFromReport(report.status, gate.isFinal);
  const scanName = (scans.data ?? []).find((s) => s.id === report.scanId)?.name;

  const groups = new Map<string, FindingApi[]>();
  for (const f of findings.data ?? []) {
    const key = (f.severity || "unknown").toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const severities = [...groups.keys()].sort(
    (a, b) => severityRank(a) - severityRank(b) || a.localeCompare(b)
  );

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/reports" className="text-[12px] text-[var(--ink-muted)]">
            ← Reports
          </Link>
          <h1 className="text-[18px] font-semibold mt-1">{scanName ?? "Report"}</h1>
          <p className="text-[12px] text-[var(--ink-muted)] mt-0.5">{periodLabel(report.createdAt)}</p>
        </div>
        <Badge tone={toneForRecord(state)}>
          <span aria-hidden="true">{RECORD_GLYPH[state]}</span> {recordLabel(state)}
        </Badge>
      </div>

      {/*
        The backing scope version is always visible: it is what makes the report
        defensible. It is shown even before the gate is met, so a question about
        "which scope was this run against?" never needs a download.
      */}
      <p className="text-[13px] text-[var(--ink-muted)] mt-3">
        Scope version {scopeLabel ?? "not recorded"}
      </p>

      <div className="mt-4">
        <GateCallout gate={gate} reportId={report.id} />
      </div>

      {/*
        A dispute can only be raised while the finding is open — the portal's
        own read carries `status`, and offering the control on an already
        mitigated or accepted finding would invite a write that changes nothing.
        The control is one action on one finding: the form replaces it, and the
        confirmation replaces the form.
      */}
      <div className="mt-6">
        <h2 className="text-[15px] font-medium">Findings</h2>
        {findings.isLoading ? (
          <div className="mt-3">
            <Skeleton lines={4} />
          </div>
        ) : null}
        {!findings.isLoading && !findings.error && (findings.data ?? []).length === 0 ? (
          <p className="text-[13px] text-[var(--ink-muted)] mt-2">No findings recorded on this scan.</p>
        ) : null}

        {severities.map((sev) => {
          const list = groups.get(sev) ?? [];
          return (
            <div key={sev} className="mt-4">
              <div className="flex items-center gap-2">
                <Badge tone={SEVERITY_TONE[sev] ?? "idle"}>
                  {severityLabel(sev)} · {list.length}
                </Badge>
              </div>
              <ul className="mt-2 space-y-2">
                {list.map((f) => (
                  <li key={f.id} className="border border-[var(--border)] rounded-[var(--radius)] px-4 py-3">
                    <div className="text-[14px] font-medium">{f.title}</div>
                    <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">
                      {f.cveId ? `${f.cveId} · ` : ""}QID {f.qid}
                    </div>
                    {f.status === "open" ? (
                      <div className="mt-2">
                        {raisedFindingId === f.id ? (
                          <p role="status" className="text-[12px] text-[var(--ink-muted)]">
                            Dispute raised — it is awaiting review.
                          </p>
                        ) : disputingFindingId === f.id ? (
                          <DisputeForm
                            findingId={f.id}
                            pending={raiseDispute.isPending}
                            error={raiseDispute.error}
                            onSubmit={(findingId, justification) => raiseDispute.mutate({ findingId, justification })}
                            onCancel={() => setDisputingFindingId(null)}
                          />
                        ) : (
                          <Button variant="secondary" onClick={() => setDisputingFindingId(f.id)}>
                            Raise dispute
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
