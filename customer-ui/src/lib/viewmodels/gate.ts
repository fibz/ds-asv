export interface GateInput {
  status: string;
  scopeVersionId: string | null;
  approvedScopeVersionId: string | null;
  attestationStatus: string | null;
  scopeLabel: string | null;
  attestedAt: string | null;
}

export interface GateCondition {
  key: "attestation" | "scope";
  label: string;
  met: boolean;
  evidence: string | null;
}

export interface GateView {
  isFinal: boolean;
  conditions: GateCondition[];
  sentence: string;
  blockReason: string | null;
  canDownload: boolean;
}

/**
 * Mirrors the service rule in portal/src/lib/scan/report.ts (isReportFinal):
 * final == attested AND a recorded scope version that is the approved one.
 * The report's own scopeVersionId alone never satisfies the scope condition —
 * it must equal the approved version id. The UI must never invent a weaker test.
 */
export function reportGate(input: GateInput): GateView {
  const attestationMet = input.status === "attested";
  const scopeMet =
    Boolean(input.scopeVersionId) && input.scopeVersionId === input.approvedScopeVersionId;
  const isFinal = attestationMet && scopeMet;

  const conditions: GateCondition[] = [
    {
      key: "attestation",
      label: "QA attestation",
      met: attestationMet,
      evidence: attestationMet
        ? input.attestedAt
          ? `attested ${input.attestedAt}`
          : "attested"
        : input.attestationStatus === "submitted"
          ? "pending review"
          : "not submitted",
    },
    {
      key: "scope",
      label: "Scope version approved",
      met: scopeMet,
      evidence: scopeMet
        ? input.scopeLabel
        : input.scopeVersionId
          ? `${input.scopeLabel ?? "recorded version"} not approved`
          : "no version recorded",
    },
  ];

  let blockReason: string | null = null;
  if (!scopeMet) blockReason = "No approved scope version backs this report";
  else if (!attestationMet) blockReason = "Attestation pending";

  const sentence = isFinal
    ? `Attested${input.attestedAt ? ` on ${input.attestedAt}` : ""}${
        input.scopeLabel ? ` against approved scope ${input.scopeLabel}` : ""
      }.`
    : `${conditions.filter((c) => c.met).length} of 2 conditions met — ${blockReason}. The report stays in draft until both are met.`;

  return { isFinal, conditions, sentence, blockReason, canDownload: isFinal };
}

/**
 * The single place the set of final report ids is derived. Home, the sidebar
 * (useStageRows) and Reports all need "which reports are final" — deriving it
 * more than once would let the screens drift apart. Pure, so it is testable
 * without a render.
 */
export function finalReportIdsOf(
  reports: { id: string; status: string; scopeVersionId: string | null; attestation: { status: string; reviewedAt: string | null } | null }[],
  approvedScopeVersionId: string | null
): string[] {
  return reports
    .filter((r) =>
      reportGate({
        status: r.status,
        scopeVersionId: r.scopeVersionId,
        approvedScopeVersionId,
        attestationStatus: r.attestation?.status ?? null,
        scopeLabel: null,
        attestedAt: r.attestation?.reviewedAt ?? null,
      }).isFinal
    )
    .map((r) => r.id);
}
