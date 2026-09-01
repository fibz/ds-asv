import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listScopeSets, getScopeVersion } from "@/lib/scope/service";
import { listScans } from "@/lib/scan/service";
import { ScannerClient } from "./client";
import type { ApprovedScopeVersionRow, ScanRow } from "./client";

export default async function ScannersPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");

  // Read gate: server-component reads don't pass through the API role gates,
  // so gate here — can() relaxes in dev/test, but in prod only members with
  // scan.view may see scan data.
  if (!can(ctx, "scan.view")) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scanners</h1>
          <p className="text-gray-600">
            Insufficient permissions — scan.view is required to view scanners.
          </p>
        </div>
      </div>
    );
  }

  const scopeSets = await listScopeSets(ctx); // includes versions, desc by versionNumber
  const scans = await listScans(ctx); // recent first, includes targets

  // The prod scan gate (createScanFromAssets) requires every target to be in an
  // approved scope version, so the Run Scan picker is limited to approved
  // versions. listScopeSets does not include version items — fetch each
  // approved version's items so the client can submit its assetIds. Newest
  // approved version first (the defensible current scope, per spec §5.5).
  const approvedScopeVersions: ApprovedScopeVersionRow[] = (
    await Promise.all(
      scopeSets.flatMap((set) =>
        set.versions
          .filter((v) => v.status === "approved")
          .map(async (v) => {
            const full = await getScopeVersion(ctx, v.id);
            return {
              id: v.id,
              scopeSetId: set.id,
              scopeSetName: set.name,
              versionNumber: v.versionNumber,
              createdAt: v.createdAt.toISOString(),
              assetIds: (full?.items ?? [])
                .map((it) => it.assetId)
                .filter((id): id is string => Boolean(id)),
            };
          })
      )
    )
  ).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const rows: ScanRow[] = scans.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    targetCount: s.targets.length,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scanners</h1>
        <p className="text-gray-600">
          Run scans against your approved scope — every target must be in an approved scope version.
        </p>
      </div>
      <ScannerClient approvedScopeVersions={approvedScopeVersions} scans={rows} />
    </div>
  );
}