import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma-client";
import { getAsset } from "@/lib/assets/service";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const { id } = await params;
  const asset = await getAsset(ctx, id);
  if (!asset) return <p className="p-8 text-gray-500">Asset not found.</p>;

  const verifications = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.assetVerification.findMany({ where: { assetId: id }, orderBy: { createdAt: "desc" } });
  });

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">{asset.displayName ?? asset.canonicalIdentifier}</h1>
      <dl className="bg-white rounded-lg shadow border p-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-gray-500">Identifier</dt><dd className="font-mono">{asset.canonicalIdentifier}</dd></div>
        <div><dt className="text-gray-500">Type</dt><dd>{asset.type}</dd></div>
        <div><dt className="text-gray-500">Owner</dt><dd>{asset.owner ?? "—"}</dd></div>
        <div><dt className="text-gray-500">Environment</dt><dd>{asset.environment ?? "—"}</dd></div>
        <div><dt className="text-gray-500">Criticality</dt><dd>{asset.criticality}</dd></div>
        <div><dt className="text-gray-500">Lifecycle</dt><dd>{asset.lifecycleState}</dd></div>
        <div><dt className="text-gray-500">Verification</dt><dd>{asset.verificationState}</dd></div>
        <div><dt className="text-gray-500">Source</dt><dd>{asset.source}</dd></div>
      </dl>

      <div className="bg-white rounded-lg shadow border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Verification history</h2>
        {verifications.length === 0 ? (
          <p className="text-sm text-gray-500">No verification attempts.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {verifications.map((v) => (
              <li key={v.id}>{v.method} — {v.status}{v.verifiedBy ? ` by ${v.verifiedBy}` : ""} {v.expiresAt ? `(expires ${v.expiresAt.toISOString().slice(0, 10)})` : ""}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
