import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listScopeSets, getScopeVersion } from "@/lib/scope/service";
import { listAssets } from "@/lib/assets/service";
import { ScopeClient } from "./client";
import type { ScopeSetRow, ScopeVersionRow } from "./client";

export default async function ScopePage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");

  const scopeSets = await listScopeSets(ctx); // includes versions, desc by versionNumber
  const assets = await listAssets(ctx, {}); // for the "create version from assets" picker

  // listScopeSets does not include version items — fetch them per version so the
  // UI can show snapshot contents (and contentHash for approved versions).
  const rows: ScopeSetRow[] = await Promise.all(
    scopeSets.map(async (set) => ({
      id: set.id,
      name: set.name,
      description: set.description,
      createdAt: set.createdAt.toISOString(),
      versions: await Promise.all(
        set.versions.map(async (v): Promise<ScopeVersionRow> => {
          const full = await getScopeVersion(ctx, v.id);
          return {
            id: v.id,
            versionNumber: v.versionNumber,
            status: v.status as ScopeVersionRow["status"],
            contentHash: v.contentHash,
            createdAt: v.createdAt.toISOString(),
            items: (full?.items ?? []).map((it) => ({
              id: it.id,
              type: it.type,
              canonicalIdentifier: it.canonicalIdentifier,
            })),
          };
        })
      ),
    }))
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scope</h1>
        <p className="text-gray-600">Immutable, versioned scope — no scan runs without an approved scope version.</p>
      </div>
      <ScopeClient scopeSets={rows} assets={assets} />
    </div>
  );
}