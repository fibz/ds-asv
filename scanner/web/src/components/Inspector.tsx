import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { suppressFinding } from "../api/findings";
import type { Finding } from "../api/types";
import { useAuth } from "../auth/store";
import { JsonViewer } from "./JsonViewer";
import { SeverityGlyph } from "./SeverityGlyph";
import { PciBar } from "./PciBar";

function ConfidenceTag({ finding }: { finding: Finding }) {
  const tone =
    finding.confidence === "authenticated"
      ? "text-pass"
      : finding.confidence === "suppressed"
        ? "text-critical"
        : "text-accent";
  return (
    <span className={`rounded border border-edge px-1.5 py-0.5 font-mono text-[11px] ${tone}`}>
      {finding.confidence}
    </span>
  );
}

/**
 * Right-side finding inspector (spec §3.5): full description, CVE link, CVSS +
 * vector, source, confidence, collapsible raw evidence, and QSA suppression
 * controls. Operators do not suppress findings (spec §2 matrix) — controls are
 * rendered for QSA/customer-security only.
 */
export function Inspector({
  finding,
  onClose,
}: {
  finding: Finding;
  onClose: () => void;
}) {
  const role = useAuth((s) => s.role);
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [showForm, setShowForm] = useState(false);

  const suppress = useMutation({
    mutationFn: () => suppressFinding(finding.id, reason.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scan"] });
      queryClient.invalidateQueries({ queryKey: ["scans"] });
    },
  });

  return (
    <aside
      aria-label="Finding inspector"
      className="flex w-full flex-col rounded-lg border border-edge bg-panel p-4 lg:w-96 lg:shrink-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <SeverityGlyph severity={finding.severity} label />
          {finding.pci_fail && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-accent">
              <PciBar fail /> PCI fail
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded border border-edge px-2 py-0.5 text-xs text-muted transition hover:text-primary"
        >
          close
        </button>
      </div>

      <h2 className="mt-3 text-sm font-medium leading-snug text-primary">
        {finding.title}
      </h2>

      <dl className="mt-3 space-y-2 font-mono text-xs">
        {finding.cve_id && (
          <div className="flex items-center gap-2">
            <dt className="text-muted">CVE</dt>
            <dd>
              <a
                href={`https://nvd.nist.gov/vuln/detail/${finding.cve_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                {finding.cve_id} ↗
              </a>
            </dd>
          </div>
        )}
        <div className="flex items-center gap-2">
          <dt className="text-muted">CVSS</dt>
          <dd className="text-primary">{finding.cvss_score ?? "—"}</dd>
          {finding.cvss_vector && (
            <dd className="text-muted" title={finding.cvss_vector}>
              {finding.cvss_vector}
            </dd>
          )}
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted">Source</dt>
          <dd className="text-muted">{finding.source}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted">Confidence</dt>
          <dd>
            <ConfidenceTag finding={finding} />
          </dd>
        </div>
      </dl>

      {finding.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-primary/90">
          {finding.description}
        </p>
      )}

      <div className="mt-4">
        <JsonViewer raw={finding.raw_evidence} />
      </div>

      {role === "qsa" && (
        <div className="mt-4 border-t border-edge pt-3">
          {finding.is_suppressed ? (
            <p className="text-xs text-critical">
              Suppressed
              {finding.suppression_reason
                ? ` — ${finding.suppression_reason}`
                : ""}
            </p>
          ) : showForm ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                suppress.mutate();
              }}
            >
              <label className="block text-xs text-muted" htmlFor="suppress-reason">
                Reason (optional)
              </label>
              <textarea
                id="suppress-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded border border-edge bg-surface px-2 py-1.5 text-xs text-primary"
              />
              {suppress.isError && (
                <p role="alert" className="text-xs text-critical">
                  Suppression failed — {String(suppress.error)}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={suppress.isPending}
                  className="rounded bg-critical/20 px-3 py-1.5 text-xs font-medium text-critical transition hover:bg-critical/30 disabled:opacity-50"
                >
                  {suppress.isPending ? "Suppressing…" : "Suppress finding"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded border border-edge px-3 py-1.5 text-xs text-muted"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded border border-critical/40 px-3 py-1.5 text-xs text-critical transition hover:bg-critical/10"
            >
              Suppress finding
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
