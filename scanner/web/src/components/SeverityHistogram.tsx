import { useMemo } from "react";
import type { ScanHistoryItem } from "../api/types";
import { bucketLastSevenDays, SEVERITY_COLORS, SEVERITY_ORDER, totalOf } from "../lib/severity";

const WIDTH = 560;
const HEIGHT = 160;
const PAD_BOTTOM = 24;
const PAD_TOP = 12;
const BAR_GAP = 10;

/**
 * Severity histogram — last 7 days, hand-rolled SVG (spec §3.1/§4.4). One bar
 * per day, stacked by severity. Data is computed client-side from the scan
 * list's submitted_at + severity_counts; no chart library.
 */
export function SeverityHistogram({ scans }: { scans: ScanHistoryItem[] }) {
  const days = useMemo(() => bucketLastSevenDays(scans), [scans]);
  const maxTotal = Math.max(1, ...days.map((d) => totalOf(d.counts)));

  const innerWidth = WIDTH - 2;
  const barWidth = (innerWidth - BAR_GAP * (days.length - 1)) / days.length;
  const plotHeight = HEIGHT - PAD_BOTTOM - PAD_TOP;

  return (
    <section
      aria-label="Severity histogram — last 7 days"
      className="rounded-lg border border-edge bg-panel p-4"
    >
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
        Severity, last 7 days
      </h2>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Bar chart of finding severity counts per day"
        className="mt-2 w-full"
      >
        {days.map((day, i) => {
          const x = i * (barWidth + BAR_GAP);
          const segments = SEVERITY_ORDER.filter(
            (s) => day.counts[s] > 0
          ).reverse(); // draw critical at the bottom
          let y = PAD_TOP + plotHeight;
          return segments.map((severity) => {
            const count = day.counts[severity];
            const h = (count / maxTotal) * plotHeight;
            const rect = (
              <rect
                key={`${day.label}-${severity}`}
                x={x}
                y={y - h}
                width={barWidth}
                height={Math.max(h, 1)}
                fill={SEVERITY_COLORS[severity]}
              />
            );
            y -= h;
            return rect;
          });
        })}
        {days.map((day, i) => (
          <text
            key={day.label}
            x={i * (barWidth + BAR_GAP) + barWidth / 2}
            y={HEIGHT - 6}
            textAnchor="middle"
            className="fill-muted"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
          >
            {day.label}
          </text>
        ))}
      </svg>
      <Legend />
    </section>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-hidden>
      {SEVERITY_ORDER.map((severity) => (
        <span
          key={severity}
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted"
        >
          <span
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: SEVERITY_COLORS[severity] }}
          />
          {severity}
        </span>
      ))}
    </div>
  );
}
