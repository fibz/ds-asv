"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ContactRow {
  id?: string;
  type: string;
  name: string;
  email: string;
  phone: string | null;
  escalationOrder: number;
}

const TYPES = ["business", "security", "billing", "emergency"];

export function OrgProfileForm({ name, contacts, canManage }: { name: string; contacts: ContactRow[]; canManage: boolean }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [rows, setRows] = useState<ContactRow[]>(contacts);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/org", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: orgName,
        contacts: rows.map(({ id, type, name, email, phone, escalationOrder }) => ({ id, type, name, email, phone, escalationOrder })),
      }),
    });
    if (res.ok) { setSaved(true); router.refresh(); }
    else { const b = await res.json().catch(() => ({})); setError(b.error ?? "Save failed"); }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700">Organization name</label>
        <input
          value={orgName} disabled={!canManage}
          onChange={(e) => setOrgName(e.target.value)}
          className="mt-1 border border-gray-300 rounded px-3 py-2 text-sm w-full max-w-md"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Security & notification contacts</label>
        <div className="mt-2 space-y-2">
          {rows.map((c, i) => (
            <div key={c.id ?? i} className="flex gap-2 items-center text-sm">
              <select
                value={c.type} disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, type: e.target.value } : r)))}
                className="border border-gray-300 rounded px-2 py-1"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                placeholder="Name" value={c.name} disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                className="border border-gray-300 rounded px-2 py-1"
              />
              <input
                type="email" placeholder="Email" value={c.email} disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))}
                className="border border-gray-300 rounded px-2 py-1"
              />
            </div>
          ))}
        </div>
        {canManage && (
          <button type="button" onClick={() => setRows([...rows, { type: "security", name: "", email: "", phone: null, escalationOrder: rows.length + 1 }])}
            className="mt-2 text-sm text-indigo-600">+ Add contact</button>
        )}
      </div>
      {canManage && (
        <div className="flex items-center gap-3">
          <button type="submit" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Save</button>
          {saved && <span className="text-green-600 text-sm">Saved</span>}
          {error && <span className="text-red-600 text-sm">{error}</span>}
        </div>
      )}
    </form>
  );
}
