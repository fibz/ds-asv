import type { ReactNode } from "react";
import { LifecycleNav } from "./LifecycleNav";
import { ContextBar } from "./ContextBar";
import { Skeleton } from "./Skeleton";
import { useStageRows } from "../../lib/hooks/useStageRows";
import { useOrg } from "../../lib/api/queries";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../../lib/brand";

/**
 * The chrome every in-app route shares. While the stage queries are in flight
 * the shell still renders — the nav and the context bar swap in skeleton
 * placeholders rather than blocking the whole page (a stuck sidebar must never
 * hide the content the user navigated to).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { rows, quarter, loading } = useStageRows();
  const org = useOrg();
  // The portal returns the organisation's name; fall back to a neutral label
  // rather than inventing one when it is missing.
  const orgName = org.data?.name?.trim() || "Your organisation";

  return (
    <div className="flex min-h-screen bg-[var(--canvas)]">
      {loading ? (
        <aside className="hidden min-[900px]:block w-60 shrink-0 bg-[var(--surface)] border-r border-[var(--border)]">
          <div className="px-4 py-4 border-b border-[var(--hairline)]">
            <div className="text-[14px] font-semibold">{PRODUCT_NAME}</div>
            <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">{PRODUCT_TAGLINE}</div>
          </div>
          <div className="px-4 py-4">
            <Skeleton lines={6} />
          </div>
        </aside>
      ) : (
        <LifecycleNav stages={rows} />
      )}
      <div className="flex-1 min-w-0">
        {loading ? (
          <header className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
            <Skeleton lines={1} />
          </header>
        ) : (
          <ContextBar orgName={orgName} quarter={quarter.label} daysRemaining={quarter.daysRemaining} />
        )}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
