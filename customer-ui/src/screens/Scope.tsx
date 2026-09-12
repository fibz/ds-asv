// customer-ui/src/screens/Scope.tsx
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api/client";
import { useIssueAuthorization, useScopeSets, useSubmitScopeVersion } from "../lib/api/queries";
import { authorizationFilename, saveJsonFile } from "../lib/download";
import { scopeView } from "../lib/viewmodels/scope";
import type { ScopeVersionApi } from "../lib/api/types";
import { Badge } from "../components/primitives/Badge";
import { Button } from "../components/primitives/Button";
import { Card } from "../components/primitives/Card";
import { RecordCard } from "../components/shell/RecordCard";
import { Skeleton } from "../components/shell/Skeleton";
import { ErrorState, PermissionState } from "../components/shell/states";

const day = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);
const shortHash = (hash: string | null): string | null => (hash ? hash.slice(0, 8) : null);
const itemCount = (v: ScopeVersionApi): number | null => v._count?.items ?? null;

export function Scope() {
  const scopeSets = useScopeSets();
  const submit = useSubmitScopeVersion();
  const issue = useIssueAuthorization();

  const view = scopeView({ sets: scopeSets.data ?? [] });
  const { inForce, draft, history } = view;

  const error = submit.error;
  // A 403 on submit is a permission problem, not a crash: the customer cannot
  // perform this action, so say that instead of echoing an error.
  const forbidden = error instanceof ApiError && error.status === 403;
  // The same rule for the read: a 403 on the scope list is a permission wall,
  // not a read failure with a retry that could never succeed.
  const readForbidden = scopeSets.error instanceof ApiError && scopeSets.error.status === 403;

  // There is no GET for an authorisation — the only evidence this screen can
  // have is the one it just issued — so the returned statement is pinned to the
  // version it was issued for. A result for any other version is deliberately
  // not shown, and a version that already has one is never offered a second.
  const issueError = issue.error;
  const issueForbidden = issueError instanceof ApiError && issueError.status === 403;
  const issuedAuth = issue.isSuccess && issue.variables === inForce?.id ? issue.data?.authorization ?? null : null;
  const inForceSet = (scopeSets.data ?? []).find((s) => s.id === inForce?.scopeSetId) ?? null;

  const saveAuthorization = () => {
    if (!issuedAuth || !inForce) return;
    saveJsonFile(authorizationFilename(inForceSet?.name ?? "scope", inForce.versionNumber), issuedAuth);
  };

  const heroCount = inForce ? itemCount(inForce) : null;
  const heroApproved = inForce ? day(inForce.approvedAt) : null;
  const heroHash = inForce ? shortHash(inForce.contentHash) : null;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <h1 className="text-[18px] font-semibold">Scope</h1>
      <p className="text-[14px] text-[var(--ink-muted)] mt-1">
        What is approved for scanning, and the version history behind it.
      </p>

      {scopeSets.isLoading ? (
        <div className="mt-6">
          <Skeleton lines={6} />
        </div>
      ) : null}

      {scopeSets.error && !readForbidden ? (
        <div className="mt-6">
          <ErrorState message="We couldn’t read your scope." onRetry={() => void scopeSets.refetch()} />
        </div>
      ) : null}

      {readForbidden ? (
        <div className="mt-6">
          <PermissionState permission="scope.view" />
        </div>
      ) : null}

      {!scopeSets.isLoading && !scopeSets.error ? (
        <>
          {inForce ? (
            <section aria-labelledby="scope-in-force" className="mt-6 border border-[var(--border)] rounded-[var(--radius)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[12px] uppercase tracking-wide text-[var(--ink-muted)]">In force</div>
                  <h2 id="scope-in-force" className="text-[20px] font-semibold mt-1">
                    {view.labelFor(inForce)}
                  </h2>
                </div>
                <Badge tone="accent">Approved</Badge>
              </div>

              {/* Every figure below is read straight from the API. The item count
                  comes from the nested `_count.items` only — when it is absent we
                  say nothing rather than derive a number the response never sent. */}
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                {heroCount !== null ? (
                  <div>
                    <dt className="text-[12px] text-[var(--ink-muted)]">Assets</dt>
                    <dd className="text-[14px] mt-0.5">{heroCount} assets</dd>
                  </div>
                ) : null}
                {heroApproved ? (
                  <div>
                    <dt className="text-[12px] text-[var(--ink-muted)]">Approved</dt>
                    <dd className="text-[14px] mt-0.5">{heroApproved}</dd>
                  </div>
                ) : null}
                {heroHash ? (
                  <div>
                    <dt className="text-[12px] text-[var(--ink-muted)]">Fingerprint</dt>
                    <dd className="text-[14px] mt-0.5 font-mono">{heroHash}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="flex gap-2 mt-4 flex-wrap">
                <Link
                  to="/assets"
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-[14px] font-medium px-3.5 py-2"
                >
                  View assets
                </Link>
              </div>

              {/*
                The signed authorisation for the version in force. There is no
                GET for it, so the only evidence is the statement this screen
                just issued: once it exists, the issue control is replaced by
                that statement and a save action — never a silent second issue.
              */}
              <div className="mt-4 border-t border-[var(--hairline)] pt-4">
                {issuedAuth ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">
                        Signed authorisation
                      </span>
                      <Badge tone="accent">Issued</Badge>
                    </div>
                    <p role="status" className="text-[13px] text-[var(--ink-muted)] mt-2">
                      Issued for {view.labelFor(inForce)}. Keep it with your PCI records.
                    </p>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                      <div>
                        <dt className="text-[12px] text-[var(--ink-muted)]">Issued on</dt>
                        <dd className="text-[14px] mt-0.5">{day(issuedAuth.issuedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-[var(--ink-muted)]">Scope fingerprint</dt>
                        <dd className="text-[14px] mt-0.5 font-mono">{shortHash(issuedAuth.scopeVersionHash)}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-[var(--ink-muted)]">Statement hash</dt>
                        <dd className="text-[14px] mt-0.5 font-mono">{shortHash(issuedAuth.statementHash)}</dd>
                      </div>
                    </dl>
                    <p className="text-[12px] text-[var(--ink-subtle)] mt-3">Signature</p>
                    <p className="text-[13px] font-mono break-all">{issuedAuth.signature}</p>
                    <div className="mt-3">
                      <Button variant="secondary" onClick={saveAuthorization}>
                        Save authorisation
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Button onClick={() => issue.mutate(inForce.id)} disabled={issue.isPending}>
                      {issue.isPending ? "Issuing…" : "Issue authorisation"}
                    </Button>
                    {/* A 403 is a permission wall: the role lacks
                        authorization.issue, and retrying changes nothing. */}
                    {issueForbidden ? (
                      <div className="mt-3">
                        <PermissionState permission="authorization.issue" />
                      </div>
                    ) : null}
                    {issueError && !issueForbidden ? (
                      <p role="alert" className="mt-3 text-[13px] text-[var(--fail)]">
                        {issueError.message}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          ) : (
            <section className="mt-6 border border-dashed border-[var(--border)] rounded-[var(--radius)] p-6">
              <h2 className="text-[15px] font-medium">No approved scope yet</h2>
              <p className="text-[14px] text-[var(--ink-muted)] mt-2">
                Nothing is approved, so no asset is authorised for scanning. A scope becomes active once a version is approved.
              </p>
              <Link to="/assets" className="inline-block mt-3 text-[13px] font-medium">
                View your assets →
              </Link>
            </section>
          )}

          {draft ? (
            <Card title="Draft scope" className="mt-4 border-[var(--accent-border)]">
              <p className="text-[14px]">
                {view.labelFor(draft)} is a draft and is not in force — it does not authorise any scanning until it is approved.
              </p>

              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <Button onClick={() => submit.mutate(draft.id)} disabled={submit.isPending}>
                  {submit.isPending ? "Submitting…" : "Submit for approval"}
                </Button>
              </div>

              {forbidden ? (
                <div className="mt-3">
                  <PermissionState permission="scope.manage" />
                </div>
              ) : null}
              {error && !forbidden ? (
                <p role="alert" className="mt-3 text-[13px] text-[var(--fail)]">
                  {error.message}
                </p>
              ) : null}
            </Card>
          ) : null}

          {history.length > 0 ? (
            <section className="mt-6">
              <h2 className="text-[15px] font-medium">Version history</h2>
              <ul className="mt-3 space-y-2">
                {history.map((v) => {
                  const count = itemCount(v);
                  const approved = day(v.approvedAt);
                  // Anything approved that is not the version in force has been
                  // superseded — the reason it is still listed is to be able to
                  // see what was previously authorised.
                  const superseded = v.status === "approved";
                  const bits = [approved ? `approved ${approved}` : null, count !== null ? `${count} assets` : null].filter(
                    (b): b is string => b !== null
                  );
                  return (
                    <RecordCard
                      key={v.id}
                      title={view.labelFor(v)}
                      subtitle={bits.length > 0 ? bits.join(" · ") : "No approval date recorded"}
                      status={<Badge tone={superseded ? "idle" : "accent"}>{superseded ? "Superseded" : v.status}</Badge>}
                    />
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
