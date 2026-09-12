import { Button } from "../primitives/Button";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="border border-[var(--fail-border)] bg-[var(--fail-bg)] text-[var(--fail)] rounded-[var(--radius)] p-4">
      <p className="text-[14px]">{message}</p>
      {onRetry ? <div className="mt-3"><Button variant="secondary" onClick={onRetry}>Try again</Button></div> : null}
    </div>
  );
}

export function PartialState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] p-4 text-[var(--ink-muted)]">
      <p className="text-[14px]">{message}</p>
      {onRetry ? <div className="mt-3"><Button variant="secondary" onClick={onRetry}>Retry</Button></div> : null}
    </div>
  );
}

export function PermissionState({ permission }: { permission: string }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] p-6">
      <h2 className="text-[15px] font-medium">You don’t have access to this screen</h2>
      <p className="text-[14px] text-[var(--ink-muted)] mt-2">
        It needs the <code className="text-[12px]">{permission}</code> permission. Ask an organisation owner to grant it.
      </p>
    </div>
  );
}
