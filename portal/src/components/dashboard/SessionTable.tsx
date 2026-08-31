"use client";

import { useRouter } from "next/navigation";

export interface SessionRow {
  id: string;
  userId: string;
  userAgent: string;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export function SessionTable({ sessions, currentUserId }: { sessions: SessionRow[]; currentUserId: string }) {
  const router = useRouter();
  async function revoke(id: string) {
    if (!confirm("Revoke this session? The user will be signed out.")) return;
    const res = await fetch(`/api/v1/sessions/${id}/revoke`, { method: "POST" });
    if (res.ok) router.refresh();
  }
  if (sessions.length === 0) return <p className="text-gray-500 text-sm">No active sessions.</p>;
  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">User agent</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last seen</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {sessions.map((s) => (
          <tr key={s.id}>
            <td className="px-4 py-2">{s.userAgent}{s.userId === currentUserId ? <span className="ml-2 text-xs text-indigo-600">you</span> : null}</td>
            <td className="px-4 py-2">{new Date(s.lastSeenAt).toLocaleString()}</td>
            <td className="px-4 py-2 text-right">
              <button onClick={() => revoke(s.id)} className="text-red-600 hover:text-red-800">Revoke</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
