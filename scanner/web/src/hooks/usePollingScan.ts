import { useQuery } from "@tanstack/react-query";
import { getScan } from "../api/scans";
import type { ScanStatus } from "../api/types";

const TERMINAL: ReadonlySet<ScanStatus> = new Set([
  "completed",
  "failed",
  "partial",
]);

/**
 * Poll `GET /v1/scans/:id` every 2.5s while the scan is not terminal; stops
 * as soon as a terminal status arrives (plan §4, spec §7). TanStack Query
 * keeps a single in-flight request per key; `enabled:false` stops polling.
 */
export function usePollingScan(scanId: string | undefined) {
  return useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => getScan(scanId!),
    enabled: Boolean(scanId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL.has(status) ? false : 2500;
    },
  });
}

export function isTerminal(status: ScanStatus | undefined): boolean {
  return status ? TERMINAL.has(status) : false;
}
