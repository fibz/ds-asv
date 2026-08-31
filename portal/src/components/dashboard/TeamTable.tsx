"use client";

import { useRouter } from "next/navigation";

export interface TeamMemberRow {
  id: string;
  userId: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string | null;
}

const ROLES = ["organization_owner", "security_admin", "asset_manager", "scan_operator", "report_viewer", "billing_admin"];

export function TeamTable({ members, canManage, currentUserId }: { members: TeamMemberRow[]; canManage: boolean; currentUserId: string }) {
  const router = useRouter();
  async function changeRole(memberId: string, role: string) {
    const res = await fetch(`/api/v1/team/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) router.refresh();
  }
  async function remove(memberId: string) {
    if (!confirm("Remove this member? Their sessions will be revoked.")) return;
    const res = await fetch(`/api/v1/team/members/${memberId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }
  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          {canManage && <th className="px-4 py-2" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {members.map((m) => (
          <tr key={m.id}>
            <td className="px-4 py-2">{m.email}</td>
            <td className="px-4 py-2">
              {canManage ? (
                <select
                  className="border border-gray-300 rounded px-2 py-1"
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                m.role
              )}
            </td>
            <td className="px-4 py-2">{m.status}</td>
            {canManage && (
              <td className="px-4 py-2 text-right">
                {m.userId !== currentUserId && (
                  <button onClick={() => remove(m.id)} className="text-red-600 hover:text-red-800">Remove</button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
