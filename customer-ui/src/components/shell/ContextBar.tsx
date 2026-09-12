import type { ReactNode } from "react";
import { TONE_CLASS } from "../../lib/status";

export function ContextBar({ orgName, quarter, daysRemaining, action }: {
  orgName: string; quarter: string; daysRemaining: number; action?: ReactNode;
}) {
  const urgent = daysRemaining <= 14;
  return (
    <header className="flex items-center gap-4 flex-wrap px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold truncate">{orgName}</div>
        <div className="text-[12px] text-[var(--ink-muted)]">{quarter} · PCI ASV scan window</div>
      </div>
      <div className={`border rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium ${urgent ? TONE_CLASS.warn : TONE_CLASS.idle}`}>
        {daysRemaining} days left
      </div>
      {action ? <div className="ml-auto">{action}</div> : null}
    </header>
  );
}
