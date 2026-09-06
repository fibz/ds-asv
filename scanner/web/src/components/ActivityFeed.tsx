import { useQuery } from "@tanstack/react-query";
import { listScans } from "../api/scans";
import { deriveActivityEvents } from "../lib/activity";
import { formatTimestampShort } from "../lib/time";

const KIND_COLOR: Record<string, string> = {
  started: "text-accent",
  completed: "text-pass",
  failed: "text-critical",
};

/** Recent activity feed — last 20 transitions, one mono line each (spec §3.1). */
export function ActivityFeed() {
  const { data: scans = [] } = useQuery({
    queryKey: ["scans", "activity"],
    queryFn: () => listScans({ limit: 200 }),
    refetchInterval: 10_000,
  });
  const events = deriveActivityEvents(scans);
  return (
    <section aria-label="Recent activity" className="rounded-lg border border-edge bg-panel p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
        Recent activity
      </h2>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-[11px]">
        {events.length === 0 && (
          <li className="py-2 text-muted">no recent scan activity</li>
        )}
        {events.map((event, i) => (
          <li key={`${event.at}-${i}`} className="flex gap-3">
            <span className="shrink-0 text-muted">
              {formatTimestampShort(event.at)}
            </span>
            <span className={KIND_COLOR[event.kind]}>{event.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
