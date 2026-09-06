/** String truncation helpers for mono scan IDs / targets. */

/** Keep the tail of a long ID (UUIDs carry their entropy at the end). */
export function shortId(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Truncate to max chars with a trailing ellipsis. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
