import { issueScanManifest } from "@/lib/scan/manifest";
import { getScan } from "@/lib/scan/service";
import type { TenantContext } from "@/lib/tenant";

const SCANNER_BASE_URL = process.env.SCANNER_BASE_URL || "http://localhost:8000";

/** Real prod dispatch: issue the manifest and hand it to the scanner service. */
export async function dispatchScanToScanner(
  ctx: TenantContext,
  scanId: string
): Promise<{ status: string }> {
  const scan = await getScan(ctx, scanId);
  if (!scan) throw new Error("Scan not found");
  const { manifest } = await issueScanManifest(ctx, scanId);
  const res = await fetch(`${SCANNER_BASE_URL}/v1/manifests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`scanner dispatch failed (${res.status}): ${text}`);
  }
  return { status: "accepted" };
}
