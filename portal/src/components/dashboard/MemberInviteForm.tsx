"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = ["organization_owner", "security_admin", "asset_manager", "scan_operator", "report_viewer", "billing_admin"];

export function MemberInviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("security_admin");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      setEmail("");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Invitation failed");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="email" required placeholder="colleague@example.com" value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
      />
      <select value={role} onChange={(e) => setRole(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm">
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <button type="submit" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Invite</button>
      {error && <span className="text-red-600 text-sm">{error}</span>}
    </form>
  );
}
