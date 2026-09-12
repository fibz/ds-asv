// customer-ui/src/components/primitives/Field.tsx
import type { ReactNode } from "react";

export function Field({ label, htmlFor, error, children }: {
  label: string; htmlFor: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11px] uppercase tracking-[0.07em] text-[var(--ink-subtle)]">{label}</label>
      {children}
      {error ? <p className="text-[12px] text-[var(--fail)]">{error}</p> : null}
    </div>
  );
}
