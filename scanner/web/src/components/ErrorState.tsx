/** Error banner: message + optional dismiss/retry affordance. Used for 403/404/
 * 5xx and network failures from the API client (spec §7.1). */
export function ErrorState({
  title,
  detail,
  onDismiss,
  actionLabel = "Retry",
}: {
  title: string;
  detail?: string;
  onDismiss?: () => void;
  actionLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-4 rounded-lg border border-critical/40 bg-panel px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-critical">{title}</p>
        {detail && (
          <p className="mt-0.5 truncate font-mono text-xs text-muted">{detail}</p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded border border-edge px-2.5 py-1 text-xs text-muted transition hover:border-accent/60 hover:text-primary"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
