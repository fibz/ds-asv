// customer-ui/src/components/primitives/Badge.tsx
import type { ReactNode } from "react";
import { TONE_CLASS, type Tone } from "../../lib/status";

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 border rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
