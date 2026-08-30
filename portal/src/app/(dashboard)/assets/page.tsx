import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma-client";
import { listAssets } from "@/lib/assets/service";
import { AssetTable } from "@/components/dashboard/AssetTable";
import { AssetImportForm } from "@/components/dashboard/AssetImportForm";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; lifecycleState?: string; search?: string }>;
}) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const params = await searchParams;
  const assets = await listAssets(ctx, {
    type: params.type, lifecycleState: params.lifecycleState, search: params.search,
  });

  const importHistory = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.assetImport.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
          <p className="text-gray-600">Canonical inventory — IPv4/IPv6/CIDR/FQDN. Retire, never delete.</p>
        </div>
        <AssetImportForm />
      </div>

      <form className="flex gap-2" method="GET">
        <input name="search" defaultValue={params.search} placeholder="Search name or identifier" className="px-3 py-2 border rounded-md text-sm" />
        <select name="type" defaultValue={params.type ?? ""} className="px-3 py-2 border rounded-md text-sm">
          <option value="">All types</option>
          <option value="ipv4">IPv4</option>
          <option value="ipv6">IPv6</option>
          <option value="cidr">CIDR</option>
          <option value="fqdn">FQDN</option>
        </select>
        <select name="lifecycleState" defaultValue={params.lifecycleState ?? ""} className="px-3 py-2 border rounded-md text-sm">
          <option value="">All states</option>
          {["draft","pending_verification","active","suspended","retiring","retired","rejected"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm">Filter</button>
      </form>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <AssetTable assets={assets} />
      </div>

      {importHistory.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Recent imports</h2>
          <ul className="text-sm text-gray-700 space-y-1">
            {importHistory.map((imp) => (
              <li key={imp.id}>
                {imp.createdAt.toISOString().slice(0, 16)} — created {(imp.summary as { created?: number }).created ?? 0}, duplicates {(imp.summary as { duplicates?: number }).duplicates ?? 0}, invalid {(imp.summary as { invalid?: number }).invalid ?? 0}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
