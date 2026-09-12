import { useEffect, useMemo, useState } from "react";
import { formatElapsed } from "../lib/time";

/**
 * Live-updating elapsed timer from a start ISO timestamp. Respects
 * `prefers-reduced-motion` (spec §4.5): when the user prefers reduced motion
 * the value is a static snapshot computed once, never ticking.
 */
export function useElapsed(startedAt: string | null | undefined): string {
  const prefersReduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (prefersReduced) return; // static snapshot, no interval
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [prefersReduced]);

  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "—";
  return formatElapsed((now - start) / 1000);
}
