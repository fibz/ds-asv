"use client";

export interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export function AuditTable({ events }: { events: AuditRow[] }) {
  if (events.length === 0) return <p className="text-gray-500 text-sm">No events yet.</p>;
  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">When</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actor</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {events.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
            <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
            <td className="px-4 py-2">{e.resourceType}{e.resourceId ? `:${e.resourceId}` : ""}</td>
            <td className="px-4 py-2">{e.actorUserId ?? "system"}</td>
            <td className="px-4 py-2">{e.reason ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
