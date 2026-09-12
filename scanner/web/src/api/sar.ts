import { useAuth } from "../auth/store";

/** `GET /v1/scans/{scan_id}/sar` path (gated to COMPLETED scans server-side). */
export function sarUrl(scanId: string): string {
  return `/v1/scans/${encodeURIComponent(scanId)}/sar`;
}

/**
 * Download a SAR. A bare `<a href>` cannot carry the Authorization header, so
 * fetch it with the session token and hand the blob to the browser.
 * Returns false when the download fails (e.g. 400 for a non-completed scan).
 */
export async function downloadSar(scanId: string): Promise<boolean> {
  const token = useAuth.getState().token;
  if (!token) return false;
  const res = await fetch(sarUrl(scanId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? `SAR-${scanId}`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
