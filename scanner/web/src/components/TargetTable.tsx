import type { ScanTargetDetail } from "../api/types";
import { formatElapsed, formatTimestamp } from "../lib/time";
import { PortTable } from "./PortTable";

function statusColor(status: string): string {
  if (status === "completed") return "text-pass";
  if (status === "failed" || status === "error") return "text-critical";
  if (status === "running" || status === "enqueued") return "text-accent";
  return "text-muted";
}

/** Per-target card (spec §3.4): hostname/IP, status, duration, error, ports. */
export function TargetTable({ targets }: { targets: ScanTargetDetail[] }) {
  return (
    <div className="space-y-3">
      {targets.map((t) => (
        <article
          key={t.target}
          className="rounded-lg border border-edge bg-panel p-4"
        >
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-sm text-primary">{t.target}</h3>
            <div className="flex items-baseline gap-4 font-mono text-xs text-muted">
              {t.ip_address && <span>{t.ip_address}</span>}
              <span className={statusColor(t.status)}>{t.status}</span>
              <span>
                {t.duration_seconds != null
                  ? formatElapsed(t.duration_seconds)
                  : "—"}
              </span>
              <span className="text-[10px] text-muted">
                {formatTimestamp(t.started_at)}
              </span>
            </div>
          </header>
          {t.error_message && (
            <p className="mt-2 font-mono text-xs text-critical">{t.error_message}</p>
          )}
          <div className="mt-3">
            <PortTable ports={t.open_ports} />
          </div>
        </article>
      ))}
      {targets.length === 0 && (
        <p className="py-2 font-mono text-xs text-muted">no targets recorded</p>
      )}
    </div>
  );
}
