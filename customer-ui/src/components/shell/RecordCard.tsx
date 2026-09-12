// customer-ui/src/components/shell/RecordCard.tsx
import type { ReactNode } from "react";

export function RecordCard({ title, subtitle, status, meta, actions, tone = "idle" }: {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tone?: "idle" | "accent";
}) {
  return (
    <li
      data-testid="record-card"
      className={`border rounded-[var(--radius)] px-4 py-3 ${
        tone === "accent" ? "border-[var(--accent-border)]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium truncate">{title}</div>
          {subtitle ? <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">{subtitle}</div> : null}
        </div>
        {status}
      </div>
      {meta ? <div className="text-[12px] text-[var(--ink-muted)] mt-2">{meta}</div> : null}
      {actions ? <div className="flex gap-2 mt-3 flex-wrap">{actions}</div> : null}
    </li>
  );
}
