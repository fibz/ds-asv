import type { Severity } from "../api/types";
import { SEVERITY_COLORS, SEVERITY_GLYPH } from "../lib/severity";

/** Colored mono severity glyph. Color is never the only signal: pair with the
 * severity label/title (spec §4.5). */
export function SeverityGlyph({
  severity,
  label,
}: {
  severity: Severity;
  label?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono"
      style={{ color: SEVERITY_COLORS[severity] }}
    >
      <span aria-hidden>{SEVERITY_GLYPH[severity]}</span>
      {label && <span className="text-xs text-muted">{severity}</span>}
    </span>
  );
}
