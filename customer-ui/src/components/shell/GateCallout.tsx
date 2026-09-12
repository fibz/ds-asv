// customer-ui/src/components/shell/GateCallout.tsx
import type { GateView } from "../../lib/viewmodels/gate";
import { TONE_CLASS } from "../../lib/status";

/**
 * The download is the primary action on a single-report screen (ReportDetail),
 * but a Reports list renders one per card - five filled buttons is not "one
 * primary action per screen". The caller picks the variant; the default keeps
 * the single-report screen's primary intact.
 */
const DOWNLOAD_CLASS: Record<"primary" | "secondary", string> = {
  primary: "bg-[var(--accent)] text-white hover:opacity-90",
  secondary: "border border-[var(--border)] text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--canvas)]",
};

/**
 * The finalisation gate, rendered the same way wherever a report is shown.
 *
 * Every condition is a row with a tone (pass/warn), a glyph and its evidence,
 * followed by the one-sentence position. The download appears ONLY when the
 * gate passes; when it does not, the sentence names the missing condition
 * instead — a disabled control with no explanation would leave the merchant
 * guessing why the PDF is unavailable.
 */
export function GateCallout({
  gate,
  reportId,
  downloadVariant = "primary",
}: {
  gate: GateView;
  reportId: string;
  downloadVariant?: "primary" | "secondary";
}) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] p-4">
      <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">Finalisation gate</div>

      <ul className="mt-3 space-y-1.5">
        {gate.conditions.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-[14px]">
            <span
              aria-hidden="true"
              className={`border rounded-[var(--radius-sm)] px-1 text-[12px] ${TONE_CLASS[c.met ? "pass" : "warn"]}`}
            >
              {c.met ? "✔" : "◐"}
            </span>
            <span>{c.label}</span>
            <span className="ml-auto text-[12px] text-[var(--ink-muted)]">{c.evidence}</span>
          </li>
        ))}
      </ul>

      <p className="text-[13px] text-[var(--ink-muted)] mt-3">{gate.sentence}</p>

      {gate.canDownload ? (
        <a
          href={`/api/v1/reports/${reportId}/download`}
          className={`mt-3 inline-flex rounded-[var(--radius)] text-[14px] font-medium px-3.5 py-2 ${DOWNLOAD_CLASS[downloadVariant]}`}
        >
          Download PDF
        </a>
      ) : (
        <p className="text-[12px] text-[var(--ink-subtle)] mt-3">
          Download becomes available when every condition is met.
        </p>
      )}
    </div>
  );
}
