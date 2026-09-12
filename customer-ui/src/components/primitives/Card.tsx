// customer-ui/src/components/primitives/Card.tsx
import type { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: {
  title?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] ${className}`}>
      {title || action ? (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--hairline)]">
          {title ? <h3 className="text-[15px] font-medium">{title}</h3> : <span />}
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
