import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listAssets } from "@/lib/assets/service";
import { getScopeVersion, listScopeSets } from "@/lib/scope/service";
import { ScopeClient } from "@/app/(dashboard)/scope/client";
import type { ScopeSetRow, ScopeVersionRow } from "@/app/(dashboard)/scope/client";

export default async function CustomerScopePage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "scope.view")) return <div className="space-y-8"><h1 className="text-2xl font-bold text-gray-900">Scope</h1><p className="text-gray-600">Insufficient permissions — scope.view is required to view scope.</p></div>;
  const scopeSets = await listScopeSets(ctx);
  const assets = await listAssets(ctx, {});
  const rows: ScopeSetRow[] = await Promise.all(scopeSets.map(async (set) => ({
    id: set.id, name: set.name, description: set.description, createdAt: set.createdAt.toISOString(),
    versions: await Promise.all(set.versions.map(async (version): Promise<ScopeVersionRow> => {
      const full = await getScopeVersion(ctx, version.id);
      return { id: version.id, versionNumber: version.versionNumber, status: version.status as ScopeVersionRow["status"], contentHash: version.contentHash, createdAt: version.createdAt.toISOString(), items: (full?.items ?? []).map((item) => ({ id: item.id, type: item.type, canonicalIdentifier: item.canonicalIdentifier })) };
    })),
  })));
  return <div className="space-y-8"><div><h1 className="text-2xl font-bold text-gray-900">Scope</h1><p className="text-gray-600">Immutable, versioned scope — no scan runs without an approved scope version.</p></div><ScopeClient scopeSets={rows} assets={assets} /></div>;
}
