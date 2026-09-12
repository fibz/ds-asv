/** Time formatting helpers (spec §4.2 — mono timestamps). */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO timestamp → "2026-09-06 10:21" (local time, mono-friendly). */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** ISO timestamp → compact "06 Sep 10:21" for narrow surfaces. */
export function formatTimestampShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Seconds → "12m 4s" (or "1h 02m" past an hour). */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Date → "Sep 3" for histogram x-axis labels. */
export function formatDayLabel(date: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/** Whole days between now and an ISO timestamp (for "x days ago" ranges). */
export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86_400_000);
}
