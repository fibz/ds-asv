import { TONE_CLASS, glyphFor, toneForStage, type StageState } from "../../lib/status";

export function StageProgress({ steps }: { steps: { label: string; state: StageState }[] }) {
  return (
    <ol className="flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span
            data-testid={`step-${s.label}`}
            data-state={s.state}
            className={`inline-flex items-center gap-1.5 border rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[toneForStage(s.state)]}`}
          >
            <span aria-hidden="true">{glyphFor(s.state)}</span>
            {s.label}
          </span>
          {i < steps.length - 1 ? <span aria-hidden="true" className="text-[var(--ink-subtle)]">→</span> : null}
        </li>
      ))}
    </ol>
  );
}
