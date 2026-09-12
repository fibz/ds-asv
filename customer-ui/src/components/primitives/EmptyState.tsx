// customer-ui/src/components/primitives/EmptyState.tsx
import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-[var(--border)] rounded-[var(--radius)] p-8 text-center">
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="text-[14px] text-[var(--ink-muted)] mt-2">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
