import Link from "next/link";

export interface AssetRow {
  id: string;
  type: string;
  canonicalIdentifier: string;
  displayName: string | null;
  owner: string | null;
  environment: string | null;
  criticality: string;
  lifecycleState: string;
  verificationState: string;
}

export function AssetTable({ assets }: { assets: AssetRow[] }) {
  if (assets.length === 0) {
    return <p className="text-sm text-gray-500">No assets yet. Add one manually or import a CSV.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-2 pr-4">Identifier</th>
          <th className="py-2 pr-4">Name</th>
          <th className="py-2 pr-4">Type</th>
          <th className="py-2 pr-4">Criticality</th>
          <th className="py-2 pr-4">Lifecycle</th>
          <th className="py-2 pr-4">Verification</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a) => (
          <tr key={a.id} className="border-b last:border-0">
            <td className="py-2 pr-4 font-mono">
              <Link href={`/assets/${a.id}`} className="text-indigo-600 hover:underline">{a.canonicalIdentifier}</Link>
            </td>
            <td className="py-2 pr-4">{a.displayName ?? "—"}</td>
            <td className="py-2 pr-4">{a.type}</td>
            <td className="py-2 pr-4">{a.criticality}</td>
            <td className="py-2 pr-4">{a.lifecycleState}</td>
            <td className="py-2 pr-4">{a.verificationState}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
