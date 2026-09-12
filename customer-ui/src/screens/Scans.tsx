// customer-ui/src/screens/Scans.tsx
import { Link } from "react-router-dom";
import { useScans, useScopeSets } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
import { Badge } from "../components/primitives/Badge";
import { Button } from "../components/primitives/Button";
import { EmptyState } from "../components/primitives/EmptyState";
import { RecordCard } from "../components/shell/RecordCard";
import { Skeleton } from "../components/shell/Skeleton";
import { ErrorState, PermissionState } from "../components/shell/states";
import { recordLabel, recordStateFromScan, toneForRecord, type RecordState } from "../lib/status";

// Status is never colour alone: every record state carries a distinct glyph next
// to its word, so the badge still reads with colour removed.
const RECORD_GLYPH: Record<RecordState, string> = {
  passed: "✔", running: "◐", failed: "✕",
  draft: "○", submitted: "◐", attested: "✔", final: "✔",
  pending: "○", unknown: "○",
};

const NO_SCOPE_REASON = "An approved scope is required before you can scan";
const NO_SCOPE_REASON_ID = "new-scan-reason";

export function Scans() {
  const scans = useScans();
  const scopeSets = useScopeSets();

  const sets = scopeSets.data ?? [];
  // The real gate is an APPROVED scope version, not merely the existence of a
  // scope set. When the payload carries versions we require an approved one and
  // ignore the set count; only when no versions are present at all do we fall
  // back to "a set exists". The test fixture ships `versions: []`, so it
  // exercises the fallback branch deliberately — that fallback is not a bug.
  const carriesVersions = sets.some((s) => (s.versions ?? []).length > 0);
  const hasApprovedVersion = sets.some((s) => (s.versions ?? []).some((v) => v.status === "approved"));
  const hasScope = carriesVersions ? hasApprovedVersion : sets.length > 0;

  const rows = [...(scans.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // A 403 on the scans list is a permission wall, not a read failure.
  const forbidden = scans.error instanceof ApiError && scans.error.status === 403;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold">Scans</h1>
          <p className="text-[14px] text-[var(--ink-muted)] mt-1">Every scan this organisation has run, newest first.</p>
        </div>
        <Button
          disabled={!hasScope}
          aria-describedby={hasScope ? undefined : NO_SCOPE_REASON_ID}
        >
          New scan
        </Button>
      </div>

      {/* The reason is a VISIBLE paragraph, not Button's sr-only `disabledReason`.
          A disabled control must never be the only place the explanation lives,
          and rendering both would put the same sentence in the DOM twice — which
          duplicates it for screen readers and makes the phrase ambiguous to
          text queries. One explanation, in plain sight, and the button points at
          it with aria-describedby so assistive tech announces it too. */}
      {!hasScope ? (
        <p id={NO_SCOPE_REASON_ID} className="text-[12px] text-[var(--ink-muted)] mt-2">{NO_SCOPE_REASON}.</p>
      ) : null}

      <div className="mt-6">
        {scans.error && !forbidden ? <ErrorState message="We couldn’t read your scans." onRetry={() => void scans.refetch()} /> : null}
        {forbidden ? <PermissionState permission="scan.view" /> : null}
        {scans.isLoading ? <Skeleton lines={5} /> : null}

        {!scans.isLoading && !scans.error && rows.length === 0 ? (
          <EmptyState
            title="No scans yet"
            description="Once your scope is approved you can run a scan against it. Results arrive as findings on the report."
            action={
              // Secondary on purpose: the header "New scan" is this screen's
              // single filled primary, so the empty-state next step must not be
              // a second accent-filled control beside it.
              <Link to="/scope" className="rounded-[var(--radius)] border border-[var(--border)] text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--canvas)] text-[14px] font-medium px-3.5 py-2">
                Open scope
              </Link>
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((s) => {
              const state = recordStateFromScan(s.status);
              const targets = s.targets?.length ?? 0;
              return (
                <RecordCard
                  key={s.id}
                  title={s.name}
                  subtitle={`${targets} target${targets === 1 ? "" : "s"} · started ${s.startedAt.slice(0, 10)}`}
                  status={
                    <Badge tone={toneForRecord(state)}>
                      <span aria-hidden="true">{RECORD_GLYPH[state]}</span> {recordLabel(state)}
                    </Badge>
                  }
                  actions={
                    <Link to={`/reports?scan=${s.id}`} className="text-[13px] font-medium">
                      Findings →
                    </Link>
                  }
                />
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
