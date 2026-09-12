// customer-ui/src/components/primitives/StatusChip.tsx
import { TONE_CLASS, glyphFor, stageLabel, toneForStage, type StageState } from "../../lib/status";

export function StatusChip({ state, detail }: { state: StageState; detail?: string }) {
  const tone = toneForStage(state);
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}>
      <span aria-hidden="true">{glyphFor(state)}</span>
      <span>{stageLabel(state)}</span>
      {detail ? <span className="text-[var(--ink-muted)]">· {detail}</span> : null}
    </span>
  );
}
