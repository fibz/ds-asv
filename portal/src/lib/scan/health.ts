const SCANNER_BASE_URL = process.env.SCANNER_BASE_URL || "http://localhost:8000";

export type ScannerHealth =
  | { available: true; service: string; version: string }
  | { available: false; error: string };

/**
 * Read the scanner's liveness endpoint without exposing its private address or
 * transport errors to portal users. This proves reachability only; it is not a
 * claim that a scan has capacity or will complete successfully.
 */
export async function getScannerHealth(): Promise<ScannerHealth> {
  const baseUrl = SCANNER_BASE_URL.replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      return { available: false, error: `Scanner health check returned ${response.status}` };
    }

    const body = await response.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      (body as { status?: unknown }).status !== "ok" ||
      typeof (body as { service?: unknown }).service !== "string" ||
      typeof (body as { version?: unknown }).version !== "string"
    ) {
      return { available: false, error: "Scanner returned an invalid health response" };
    }

    return {
      available: true,
      service: (body as { service: string }).service,
      version: (body as { version: string }).version,
    };
  } catch {
    return { available: false, error: "Scanner is unreachable" };
  }
}
