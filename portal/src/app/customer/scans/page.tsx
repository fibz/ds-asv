import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { getScopeVersion, listScopeSets } from "@/lib/scope/service";
import { listScans } from "@/lib/scan/service";
import { ScannerClient } from "@/app/(dashboard)/scanners/client";
import type { ApprovedScopeVersionRow, ScanRow } from "@/app/(dashboard)/scanners/client";

export default async function CustomerScansPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "scan.view")) return <div className="space-y-8"><h1 className="text-2xl font-bold text-gray-900">Scans</h1><p className="text-gray-600">Insufficient permissions — scan.view is required to view scans.</p></div>;
  const [scopeSets, scans] = await Promise.all([listScopeSets(ctx), listScans(ctx)]);
  const approvedScopeVersions: ApprovedScopeVersionRow[] = (await Promise.all(scopeSets.flatMap((set) => set.versions.filter((v) => v.status === "approved").map(async (version) => { const full = await getScopeVersion(ctx, version.id); return { id: version.id, scopeSetId: set.id, scopeSetName: set.name, versionNumber: version.versionNumber, createdAt: version.createdAt.toISOString(), assetIds: (full?.items ?? []).map((item) => item.assetId).filter((id): id is string => Boolean(id)) }; })))).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const rows: ScanRow[] = scans.map((scan) => ({ id: scan.id, name: scan.name, status: scan.status, createdAt: scan.createdAt.toISOString(), targetCount: scan.targets.length }));
  return <div className="space-y-8"><div><h1 className="text-2xl font-bold text-gray-900">Scans</h1><p className="text-gray-600">Run scans against your approved scope — every target must be in an approved scope version.</p></div><ScannerClient approvedScopeVersions={approvedScopeVersions} scans={rows} canRun={can(ctx, "scan.run")} /></div>;
}
